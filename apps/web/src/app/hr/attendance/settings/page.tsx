"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getPrimaryRoleCode } from "@/lib/rbac";
import { canManageStaffAttendance } from "@/lib/staff-attendance-access";
import { StaffAttendanceAdminOnly } from "@/components/hr/StaffAttendanceAdminOnly";
import { MIN_ATTENDANCE_RECORD_RETENTION_DAYS } from "@cipansor/shared";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAttendancePolicies,
  useAttendanceSites,
  useAttendanceExemptions,
  useCreateAttendanceExemption,
  useCreateAttendanceSite,
  useCreateShiftAssignment,
  useCreateShiftRotation,
  useCreateWorkShift,
  useDeleteAttendanceExemption,
  useDeleteAttendanceSite,
  useDeleteShiftAssignment,
  useDeleteShiftRotation,
  useDeleteWorkShift,
  useDeletePayrollPolicyRule,
  usePayrollGuardConfig,
  usePayrollPolicyRules,
  useShiftAssignments,
  useShiftRotations,
  useStaffList,
  useUnits,
  useUpsertAttendancePolicy,
  useUpsertPayrollGuardConfig,
  useUpsertPayrollPolicyRule,
  useWorkShifts,
  useWorkWeekConfigs,
  useUpsertWorkWeekConfig,
  useHolidaySyncConfig,
  useUpdateHolidaySyncConfig,
  useSyncHolidays,
  useHolidayDrafts,
  useApproveHolidayDraft,
  useRejectHolidayDraft,
  useRetentionPolicies,
  useUpsertRetentionPolicy,
  useLeaveTypeConfigs,
  useUpsertLeaveTypeConfig,
  LEAVE_TYPE_LABELS,
  type HolidaySyncConfig,
  type PayrollPolicyRule,
  type LeaveType,
} from "@/hooks";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { safeFormat } from "@/lib/date";

const DAYS = [
  { value: 1, label: "Sen" },
  { value: 2, label: "Sel" },
  { value: 3, label: "Rab" },
  { value: 4, label: "Kam" },
  { value: 5, label: "Jum" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Min" },
];

const RULE_MODES = [
  "NOMINAL",
  "PERSENTASE",
  "PRORATA",
  "PENGALI",
  "BERTINGKAT",
  "FORMULA",
  "MANUAL",
] as const;

const TRIGGERS = [
  "LATE",
  "ABSENT",
  "EARLY_LEAVE",
  "PRESENT",
  "OVERTIME",
] as const;

/**
 * Pengaturan Absensi — every knob the attendance policy reads.
 *
 * All of it is data: sites and radii, shifts and rotations, the work week, the
 * selfie/location policy, who is exempt, and the payroll rules that turn a
 * lateness into a deduction. Nothing here is a constant in code.
 */
export default function AttendanceSettingsPage() {
  const { user } = useAuth();
  if (user && !canManageStaffAttendance(user))
    return <StaffAttendanceAdminOnly title="Pengaturan Absensi" />;
  return <AttendanceSettings />;
}

function AttendanceSettings() {
  const [unitId, setUnitId] = useState<string>("");
  const { data: units } = useUnits();
  const { user } = useAuth();
  // Only the super admin chooses a unit (or the yayasan default). A unit admin
  // is pinned to their unit by the API, which refuses another unit outright,
  // so offering them a picker would only offer refusals.
  const isSuperAdmin = getPrimaryRoleCode(user) === "SUPER_ADMIN";
  const scope = isSuperAdmin && unitId ? { unitId } : undefined;
  /** The unit whose settings are on screen; null = the yayasan default. */
  const shownUnitId = isSuperAdmin ? unitId || null : (user?.unitId ?? null);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Pengaturan Absensi
            </h1>
            <p className="text-muted-foreground">
              Lokasi, shift, hari kerja, kebijakan selfie, dan potongan
              kehadiran
            </p>
          </div>
          {isSuperAdmin && (
            <Select
              value={unitId || "ALL"}
              onValueChange={(v) => setUnitId(v === "ALL" ? "" : v)}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Semua unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua unit (yayasan)</SelectItem>
                {units?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Tabs defaultValue="sites">
          <TabsList className="justify-start">
            <TabsTrigger value="sites">Lokasi</TabsTrigger>
            <TabsTrigger value="shifts">Shift</TabsTrigger>
            <TabsTrigger value="rotations">Rotasi</TabsTrigger>
            <TabsTrigger value="week">Hari Kerja</TabsTrigger>
            <TabsTrigger value="holidays">Hari Libur</TabsTrigger>
            <TabsTrigger value="policy">Kebijakan</TabsTrigger>
            <TabsTrigger value="exempt">Pengecualian</TabsTrigger>
            <TabsTrigger value="leave">Jenis Cuti</TabsTrigger>
            <TabsTrigger value="retention">Retensi</TabsTrigger>
            <TabsTrigger value="payroll">Potongan Gaji</TabsTrigger>
          </TabsList>

          <TabsContent value="sites">
            <SitesTab scope={scope} />
          </TabsContent>
          <TabsContent value="shifts">
            <ShiftsTab scope={scope} />
          </TabsContent>
          <TabsContent value="rotations">
            <RotationsTab scope={scope} />
          </TabsContent>
          <TabsContent value="week">
            <WorkWeekTab scope={scope} />
          </TabsContent>
          <TabsContent value="holidays">
            <HolidaysTab scope={scope} />
          </TabsContent>
          <TabsContent value="policy">
            <PolicyTab scope={scope} shownUnitId={shownUnitId} />
          </TabsContent>
          <TabsContent value="exempt">
            <ExemptionsTab />
          </TabsContent>
          <TabsContent value="leave">
            <LeaveTypesTab />
          </TabsContent>
          <TabsContent value="retention">
            <RetentionTab />
          </TabsContent>
          <TabsContent value="payroll">
            <PayrollTab scope={scope} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

type Scope = { unitId: string } | undefined;

function SitesTab({ scope }: { scope: Scope }) {
  const { data: sites, isLoading } = useAttendanceSites(scope);
  const create = useCreateAttendanceSite();
  const remove = useDeleteAttendanceSite();
  const [form, setForm] = useState({
    label: "",
    latitude: "",
    longitude: "",
    radiusMeters: "200",
  });

  const submit = async () => {
    if (!form.label || !form.latitude || !form.longitude) {
      toast.error("Label dan koordinat wajib diisi");
      return;
    }
    await create.mutateAsync({
      unitId: scope?.unitId ?? null,
      label: form.label,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      radiusMeters: Number(form.radiusMeters),
      isActive: true,
    });
    toast.success("Lokasi absen ditambahkan");
    setForm({ label: "", latitude: "", longitude: "", radiusMeters: "200" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Titik Lokasi Absen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Nama lokasi</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Gerbang utama"
            />
          </div>
          <div className="space-y-2">
            <Label>Latitude</Label>
            <Input
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              placeholder="-6.123456"
            />
          </div>
          <div className="space-y-2">
            <Label>Longitude</Label>
            <Input
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              placeholder="106.123456"
            />
          </div>
          <div className="space-y-2">
            <Label>Radius (meter)</Label>
            <Input
              value={form.radiusMeters}
              onChange={(e) =>
                setForm({ ...form, radiusMeters: e.target.value })
              }
            />
          </div>
        </div>
        <Button onClick={submit} disabled={create.isPending}>
          {create.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Tambah Lokasi
        </Button>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Koordinat</TableHead>
              <TableHead>Radius</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : sites?.length ? (
              sites.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="font-medium">{site.label}</TableCell>
                  <TableCell>
                    {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                  </TableCell>
                  <TableCell>{site.radiusMeters} m</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(site.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-6 text-center text-muted-foreground"
                >
                  Belum ada lokasi. Tanpa lokasi, radius tidak dapat diperiksa.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ShiftsTab({ scope }: { scope: Scope }) {
  const { data: shifts } = useWorkShifts(scope);
  const create = useCreateWorkShift();
  const remove = useDeleteWorkShift();
  const { data: staff } = useStaffList();
  const { data: assignments } = useShiftAssignments(scope);
  const assign = useCreateShiftAssignment();
  const unassign = useDeleteShiftAssignment();

  const [form, setForm] = useState({
    name: "",
    startTime: "07:00",
    endTime: "14:00",
    graceMinutes: "15",
  });
  const [pick, setPick] = useState({
    staffId: "",
    shiftId: "",
    days: [] as number[],
  });

  const submit = async () => {
    if (!form.name) {
      toast.error("Nama shift wajib diisi");
      return;
    }
    await create.mutateAsync({
      unitId: scope?.unitId ?? null,
      name: form.name,
      startTime: form.startTime,
      endTime: form.endTime,
      graceMinutes: Number(form.graceMinutes),
      crossesMidnight: form.endTime < form.startTime,
      isActive: true,
    });
    toast.success("Shift ditambahkan");
    setForm({
      name: "",
      startTime: "07:00",
      endTime: "14:00",
      graceMinutes: "15",
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Shift Kerja</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Nama shift</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Pagi"
              />
            </div>
            <div className="space-y-2">
              <Label>Jam mulai</Label>
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) =>
                  setForm({ ...form, startTime: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Jam selesai</Label>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Toleransi (menit)</Label>
              <Input
                value={form.graceMinutes}
                onChange={(e) =>
                  setForm({ ...form, graceMinutes: e.target.value })
                }
              />
            </div>
          </div>
          <Button onClick={submit} disabled={create.isPending}>
            <Plus className="mr-2 h-4 w-4" />
            Tambah Shift
          </Button>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Jam</TableHead>
                <TableHead>Toleransi</TableHead>
                <TableHead>Lintas hari</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts?.length ? (
                shifts.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium">{shift.name}</TableCell>
                    <TableCell>
                      {shift.startTime}–{shift.endTime}
                    </TableCell>
                    <TableCell>{shift.graceMinutes} menit</TableCell>
                    <TableCell>
                      {shift.crossesMidnight ? (
                        <Badge variant="secondary">Ya</Badge>
                      ) : (
                        "Tidak"
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate(shift.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Belum ada shift.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Penugasan Shift per Pegawai</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Pegawai</Label>
              <Select
                value={pick.staffId || undefined}
                onValueChange={(v) => setPick({ ...pick, staffId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih pegawai" />
                </SelectTrigger>
                <SelectContent>
                  {staff?.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.user?.name ?? s.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Shift</Label>
              <Select
                value={pick.shiftId || undefined}
                onValueChange={(v) => setPick({ ...pick, shiftId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih shift" />
                </SelectTrigger>
                <SelectContent>
                  {shifts?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.startTime}–{s.endTime})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hari berlaku (kosong = setiap hari kerja)</Label>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((day) => {
                  const active = pick.days.includes(day.value);
                  return (
                    <Button
                      key={day.value}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() =>
                        setPick({
                          ...pick,
                          days: active
                            ? pick.days.filter((d) => d !== day.value)
                            : [...pick.days, day.value],
                        })
                      }
                    >
                      {day.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
          <Button
            disabled={assign.isPending || !pick.staffId || !pick.shiftId}
            onClick={async () => {
              await assign.mutateAsync({
                staffId: pick.staffId,
                shiftId: pick.shiftId,
                effectiveFrom: new Date().toISOString().slice(0, 10),
                daysOfWeek: pick.days,
              });
              toast.success("Shift ditugaskan");
              setPick({ staffId: "", shiftId: "", days: [] });
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Tugaskan
          </Button>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pegawai</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Mulai</TableHead>
                <TableHead>Hari</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments?.length ? (
                assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.staff?.user?.name ?? a.staffId}</TableCell>
                    <TableCell>{a.shift?.name ?? a.shiftId}</TableCell>
                    <TableCell>{a.effectiveFrom.slice(0, 10)}</TableCell>
                    <TableCell>
                      {a.daysOfWeek.length
                        ? a.daysOfWeek
                            .map(
                              (d) =>
                                DAYS.find((x) => x.value === d)?.label ?? d,
                            )
                            .join(", ")
                        : "Setiap hari kerja"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => unassign.mutate(a.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Belum ada penugasan shift.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RotationsTab({ scope }: { scope: Scope }) {
  const { data: shifts } = useWorkShifts(scope);
  const { data: rotations } = useShiftRotations(scope);
  const { data: staff } = useStaffList();
  const create = useCreateShiftRotation();
  const remove = useDeleteShiftRotation();

  const [form, setForm] = useState({
    name: "",
    shiftId: "",
    cycleDays: "7",
    startDate: new Date().toISOString().slice(0, 10),
    members: [] as string[],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rotasi Shift (bergilir)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Nama rotasi</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jaga malam pekan 1"
            />
          </div>
          <div className="space-y-2">
            <Label>Shift</Label>
            <Select
              value={form.shiftId || undefined}
              onValueChange={(v) => setForm({ ...form, shiftId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih shift" />
              </SelectTrigger>
              <SelectContent>
                {shifts?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Panjang giliran (hari)</Label>
            <Input
              value={form.cycleDays}
              onChange={(e) => setForm({ ...form, cycleDays: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Mulai</Label>
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Anggota (urut sesuai giliran)</Label>
          <div className="flex flex-wrap gap-1">
            {staff?.data?.map((s) => {
              const active = form.members.includes(s.id);
              return (
                <Button
                  key={s.id}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() =>
                    setForm({
                      ...form,
                      members: active
                        ? form.members.filter((m) => m !== s.id)
                        : [...form.members, s.id],
                    })
                  }
                >
                  {s.user?.name ?? s.id}
                </Button>
              );
            })}
          </div>
        </div>

        <Button
          disabled={create.isPending || !form.name || !form.shiftId}
          onClick={async () => {
            await create.mutateAsync({
              name: form.name,
              shiftId: form.shiftId,
              memberIds: form.members,
              startDate: form.startDate,
              cycleDays: Number(form.cycleDays),
            });
            toast.success("Rotasi dibuat");
            setForm({ ...form, name: "", members: [] });
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Buat Rotasi
        </Button>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Mulai</TableHead>
              <TableHead>Giliran</TableHead>
              <TableHead>Anggota</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rotations?.length ? (
              rotations.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.shift?.name ?? r.shiftId}</TableCell>
                  <TableCell>{r.startDate.slice(0, 10)}</TableCell>
                  <TableCell>{r.cycleDays} hari</TableCell>
                  <TableCell>{r.memberIds.length} orang</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(r.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-muted-foreground"
                >
                  Belum ada rotasi.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WorkWeekTab({ scope }: { scope: Scope }) {
  const { data: configs } = useWorkWeekConfigs(scope);
  const upsert = useUpsertWorkWeekConfig();
  const current = configs?.[0];
  const [workDays, setWorkDays] = useState<number[]>(
    current?.workDays ?? [1, 2, 3, 4, 5],
  );
  const [hoursPerDay, setHoursPerDay] = useState(
    String(current?.hoursPerDay ?? 8),
  );
  const [fridayEndTime, setFridayEndTime] = useState(
    current?.fridayEndTime ?? "",
  );

  // The form initialises before the query resolves; adopt the saved values once
  // they arrive so Save cannot overwrite a unit's real settings with defaults.
  useEffect(() => {
    if (!current) return;
    setWorkDays(current.workDays ?? [1, 2, 3, 4, 5]);
    setHoursPerDay(String(current.hoursPerDay ?? 8));
    setFridayEndTime(current.fridayEndTime ?? "");
  }, [current?.id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hari Kerja & Jam Kerja</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Hari kerja</Label>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((day) => {
              const active = workDays.includes(day.value);
              return (
                <Button
                  key={day.value}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() =>
                    setWorkDays(
                      active
                        ? workDays.filter((d) => d !== day.value)
                        : [...workDays, day.value],
                    )
                  }
                >
                  {day.label}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Jam kerja per hari</Label>
            <Input
              value={hoursPerDay}
              onChange={(e) => setHoursPerDay(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Jam pulang hari Jumat (opsional)</Label>
            <Input
              type="time"
              value={fridayEndTime}
              onChange={(e) => setFridayEndTime(e.target.value)}
            />
          </div>
        </div>
        <Button
          disabled={upsert.isPending}
          onClick={async () => {
            await upsert.mutateAsync({
              unitId: scope?.unitId ?? null,
              workDays,
              hoursPerDay: Number(hoursPerDay),
              fridayEndTime: fridayEndTime || null,
              isActive: true,
            });
            toast.success("Hari kerja disimpan");
          }}
        >
          Simpan
        </Button>
      </CardContent>
    </Card>
  );
}

function HolidaysTab({ scope }: { scope: Scope }) {
  const { data: config, isLoading } = useHolidaySyncConfig();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return <HolidaySyncForm scope={scope} config={config} />;
}

function HolidaySyncForm({
  scope,
  config,
}: {
  scope: Scope;
  config?: HolidaySyncConfig;
}) {
  const update = useUpdateHolidaySyncConfig();
  const sync = useSyncHolidays();
  const [sourceUrl, setSourceUrl] = useState(config?.sourceUrl ?? "");
  const [years, setYears] = useState((config?.years ?? []).join(", "));
  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [syncYear, setSyncYear] = useState(String(new Date().getFullYear()));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sinkronisasi Hari Libur Nasional</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Hari libur ditarik dari sumber resmi lalu disimpan sebagai agenda
            yayasan. Selama sumbernya kosong, hari libur diisi manual lewat menu
            Kalender.
          </p>
          <div className="space-y-2">
            <Label>URL sumber (API hari libur)</Label>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://.../api/holidays"
            />
          </div>
          <div className="space-y-2">
            <Label>
              Tahun yang disinkronkan otomatis (pisahkan dengan koma)
            </Label>
            <Input
              value={years}
              onChange={(e) => setYears(e.target.value)}
              placeholder="2026, 2027"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Sinkronisasi otomatis</p>
              <p className="text-xs text-muted-foreground">
                Dijalankan berkala oleh penjadwal sistem.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          {config?.lastSyncedAt && (
            <p className="text-xs text-muted-foreground">
              Terakhir disinkronkan:{" "}
              {safeFormat(config.lastSyncedAt, "dd MMM yyyy HH:mm")}
            </p>
          )}
          <Button
            disabled={update.isPending}
            onClick={async () => {
              await update.mutateAsync({
                sourceUrl: sourceUrl.trim(),
                years: years
                  .split(",")
                  .map((y) => Number(y.trim()))
                  .filter((y) => Number.isInteger(y) && y > 2000),
                enabled,
              });
              toast.success("Pengaturan hari libur disimpan");
            }}
          >
            Simpan
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jalankan Sinkronisasi Sekarang</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>Tahun</Label>
            <Input
              className="w-[120px]"
              value={syncYear}
              onChange={(e) => setSyncYear(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={sync.isPending}
            onClick={async () => {
              const result = await sync.mutateAsync({
                year: Number(syncYear),
                unitId: scope?.unitId,
              });
              toast.success(
                `Sinkron selesai: ${result.created} draf baru, ${result.updated} diperbarui`,
              );
            }}
          >
            {sync.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Sinkronkan
          </Button>
        </CardContent>
      </Card>

      <HolidayDraftsCard unitId={scope?.unitId} />
    </div>
  );
}

/**
 * Review queue for imported holidays. A third-party source's dates land here,
 * not on the live calendar; until one is adopted it cannot turn a work day into
 * a holiday or a payslip into one with no deductions.
 */
function HolidayDraftsCard({ unitId }: { unitId?: string }) {
  const { data: drafts, isLoading } = useHolidayDrafts(unitId);
  const approve = useApproveHolidayDraft();
  const reject = useRejectHolidayDraft();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Draf Libur Menunggu Tinjauan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Hasil tarikan belum menjadi hari libur. Setujui yang benar; tolak yang
          keliru. Hanya libur yang disetujui yang memengaruhi hari kerja dan
          penggajian.
        </p>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !drafts?.length ? (
          <p className="text-sm text-muted-foreground">
            Tidak ada draf yang menunggu.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Keterangan</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {safeFormat(d.startDate, "dd MMM yyyy")}
                  </TableCell>
                  <TableCell>{d.title}</TableCell>
                  <TableCell className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={approve.isPending || reject.isPending}
                      onClick={async () => {
                        await approve.mutateAsync(d.id);
                        toast.success("Libur disetujui");
                      }}
                    >
                      Setujui
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={approve.isPending || reject.isPending}
                      onClick={async () => {
                        await reject.mutateAsync(d.id);
                        toast.success("Draf ditolak");
                      }}
                    >
                      Tolak
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyTab({
  scope,
  shownUnitId,
}: {
  scope: Scope;
  shownUnitId: string | null;
}) {
  const { data: policies } = useAttendancePolicies(scope);
  const upsert = useUpsertAttendancePolicy();
  // The list holds the unit's own row and the yayasan default; which one is
  // on screen decides what saving does, so pick it explicitly rather than
  // taking whichever came first.
  const own = policies?.find((p) => (p.unitId ?? null) === shownUnitId);
  const inherited =
    !own && shownUnitId ? policies?.find((p) => p.unitId == null) : undefined;
  const policy = own ?? inherited;

  const formOf = (p?: typeof policy) => ({
    graceMinutes: String(p?.graceMinutes ?? 15),
    // Off until switched on (decided 2026-10-09): no selfie is collected
    // before the staff privacy notice exists.
    requireSelfie: p?.requireSelfie ?? false,
    requireLocation: p?.requireLocation ?? false,
    outsideRadiusAction: p?.outsideRadiusAction ?? "FLAG",
    photoRetentionDays: String(p?.photoRetentionDays ?? 365),
    recordRetentionDays: String(
      p?.recordRetentionDays ?? MIN_ATTENDANCE_RECORD_RETENTION_DAYS,
    ),
  });
  const [form, setForm] = useState(formOf(policy));

  useEffect(() => {
    setForm(formOf(policy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy?.id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kebijakan Absensi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {policies && !policy ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Belum diatur. Selama kebijakan ini belum disimpan, swafoto dan
            lokasi tidak diwajibkan dan absen tidak ditolak di luar lokasi.
          </p>
        ) : inherited ? (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Unit ini mengikuti kebijakan yayasan. Menyimpan di sini membuat
            kebijakan khusus untuk unit ini.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Toleransi keterlambatan (menit)</Label>
            <Input
              value={form.graceMinutes}
              onChange={(e) =>
                setForm({ ...form, graceMinutes: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Jika di luar radius</Label>
            <Select
              value={form.outsideRadiusAction}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  outsideRadiusAction: v as "FLAG" | "REJECT",
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FLAG">Tandai untuk ditinjau</SelectItem>
                <SelectItem value="REJECT">Tolak absen</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Peramban tidak dapat membedakan lokasi palsu dari yang asli, jadi
              tanda ini bahan tinjauan, bukan bukti. &quot;Tolak&quot; hanya
              menolak posisi yang tetap di luar setelah ketelitian GPS
              diperhitungkan.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Simpan swafoto (hari)</Label>
            <Input
              value={form.photoRetentionDays}
              onChange={(e) =>
                setForm({ ...form, photoRetentionDays: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Simpan catatan absensi (hari)</Label>
            <Input
              type="number"
              min={MIN_ATTENDANCE_RECORD_RETENTION_DAYS}
              value={form.recordRetentionDays}
              onChange={(e) =>
                setForm({ ...form, recordRetentionDays: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              Paling singkat {MIN_ATTENDANCE_RECORD_RETENTION_DAYS} hari (10
              tahun): catatan ini dasar penggajian (UU KUP Ps. 28 ayat 11).
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-8">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.requireSelfie}
                onCheckedChange={(v) => setForm({ ...form, requireSelfie: v })}
              />
              Wajib swafoto
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.requireLocation}
                onCheckedChange={(v) =>
                  setForm({ ...form, requireLocation: v })
                }
              />
              Wajib lokasi
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Swafoto adalah data pribadi spesifik (UU PDP Ps. 4). Nyalakan
            sesudah pemberitahuan privasi pegawai diterbitkan.
          </p>
        </div>

        <Button
          disabled={upsert.isPending}
          onClick={async () => {
            try {
              await upsert.mutateAsync({
                unitId: scope?.unitId ?? null,
                graceMinutes: Number(form.graceMinutes),
                requireSelfie: form.requireSelfie,
                requireLocation: form.requireLocation,
                outsideRadiusAction: form.outsideRadiusAction,
                photoRetentionDays: Number(form.photoRetentionDays),
                recordRetentionDays: Number(form.recordRetentionDays),
                isActive: true,
              });
              toast.success("Kebijakan disimpan");
            } catch {
              // The API client already shows the server's reason.
            }
          }}
        >
          Simpan
        </Button>
      </CardContent>
    </Card>
  );
}

function ExemptionsTab() {
  const { data: exemptions } = useAttendanceExemptions();
  const { data: staff } = useStaffList();
  const create = useCreateAttendanceExemption();
  const remove = useDeleteAttendanceExemption();
  const [staffId, setStaffId] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pengecualian Absensi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Kyai/pimpinan pesantren dan kepala sekolah tidak diwajibkan absen.
          Tambahkan peran atau nama; keduanya adalah data, bukan bawaan kode.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Peran (role code)</Label>
            <Input
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value.toUpperCase())}
              placeholder="PESANTREN_PENGASUH"
            />
          </div>
          <div className="space-y-2">
            <Label>Atau pegawai</Label>
            <Select value={staffId || undefined} onValueChange={setStaffId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih pegawai" />
              </SelectTrigger>
              <SelectContent>
                {staff?.data?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.user?.name ?? s.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Alasan</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tugas pengasuhan"
            />
          </div>
        </div>
        <Button
          disabled={create.isPending || (!staffId && !roleCode)}
          onClick={async () => {
            await create.mutateAsync({
              staffId: staffId || undefined,
              roleCode: roleCode || undefined,
              reason: reason || undefined,
            });
            toast.success("Pengecualian ditambahkan");
            setStaffId("");
            setRoleCode("");
            setReason("");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Tambah
        </Button>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Peran</TableHead>
              <TableHead>Pegawai</TableHead>
              <TableHead>Alasan</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {exemptions?.length ? (
              exemptions.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.roleCode ?? "—"}</TableCell>
                  <TableCell>
                    {staff?.data?.find((s) => s.id === e.staffId)?.user?.name ??
                      e.staffId ??
                      "—"}
                  </TableCell>
                  <TableCell>{e.reason ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove.mutate(e.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-6 text-center text-muted-foreground"
                >
                  Belum ada pengecualian.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * LeaveTypeConfig — entitlement per leave kind, read by `getLeaveBalance`. A
 * leave kind with no row falls back to the statutory floor; a row is how a
 * unit raises it (UU 13/2003 Ps. 79: 12 is the floor, not a fixed number).
 */
function LeaveTypesTab() {
  const { data: configs, isLoading } = useLeaveTypeConfigs();
  const upsert = useUpsertLeaveTypeConfig();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!configs) return;
    setDrafts(
      Object.fromEntries(
        configs.map((c) => [
          c.leaveType,
          c.entitlementDays ? String(c.entitlementDays) : "",
        ]),
      ),
    );
  }, [configs]);

  const save = async (leaveType: LeaveType) => {
    const raw = drafts[leaveType];
    await upsert.mutateAsync({
      leaveType,
      entitlementDays: raw ? Number(raw) : null,
    });
    toast.success(`Jatah ${LEAVE_TYPE_LABELS[leaveType]} disimpan`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jatah Cuti per Jenis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Kosongkan bila jenis cuti tidak berjatah (mis. cuti melahirkan
          mengikuti UU). Cuti tahunan paling sedikit 12 hari kerja.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jenis</TableHead>
              <TableHead>Jatah (hari)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : (
              configs?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {LEAVE_TYPE_LABELS[c.leaveType]}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="w-28"
                      inputMode="numeric"
                      value={drafts[c.leaveType] ?? ""}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [c.leaveType]: e.target.value })
                      }
                      placeholder="—"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={upsert.isPending}
                      onClick={() => save(c.leaveType)}
                    >
                      Simpan
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/**
 * RetentionPolicy — how long a data type is kept, enforced by the nightly
 * `attendance-retention` job. PDP (UU 27/2022 Ps. 42) requires the processing to
 * end at the window's end, so a value here is not advisory.
 */
function RetentionTab() {
  const { data: policies, isLoading } = useRetentionPolicies();
  const upsert = useUpsertRetentionPolicy();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!policies) return;
    setDrafts(
      Object.fromEntries(
        policies.map((p) => [p.dataType, String(p.retentionDays)]),
      ),
    );
  }, [policies]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retensi Data Absensi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Selfie dan koordinat dihapus otomatis oleh pekerjaan retensi harian
          setelah masa ini berakhir.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jenis data</TableHead>
              <TableHead>Disimpan (hari)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : (
              policies?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.dataType}</TableCell>
                  <TableCell>
                    <Input
                      className="w-28"
                      inputMode="numeric"
                      value={drafts[p.dataType] ?? ""}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [p.dataType]: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={upsert.isPending}
                      onClick={async () => {
                        await upsert.mutateAsync({
                          dataType: p.dataType,
                          retentionDays: Number(
                            drafts[p.dataType] ?? p.retentionDays,
                          ),
                        });
                        toast.success(`Retensi ${p.dataType} disimpan`);
                      }}
                    >
                      Simpan
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const emptyRule: Partial<PayrollPolicyRule> = {
  code: "",
  kind: "DEDUCTION",
  trigger: "LATE",
  basis: "TUNJANGAN",
  mode: "PENGALI",
  unit: "PER_KEJADIAN",
  rounding: "NONE",
  priority: 10,
  isActive: false,
};

function PayrollTab({ scope }: { scope: Scope }) {
  const { data: rules } = usePayrollPolicyRules(scope);
  const { data: guard } = usePayrollGuardConfig(scope);
  const upsertRule = useUpsertPayrollPolicyRule();
  const removeRule = useDeletePayrollPolicyRule();
  const upsertGuard = useUpsertPayrollGuardConfig();

  const [draft, setDraft] = useState<Partial<PayrollPolicyRule>>(emptyRule);
  const [guardForm, setGuardForm] = useState({
    maxDeductionPercent: String(guard?.maxDeductionPercent ?? 50),
    minBasicSharePercent: String(guard?.minBasicSharePercent ?? 75),
    mustStayAboveUmk: guard?.mustStayAboveUmk ?? true,
    umkNominal: guard?.umkNominal ? String(guard.umkNominal) : "",
  });

  useEffect(() => {
    if (!guard) return;
    setGuardForm({
      maxDeductionPercent: String(guard.maxDeductionPercent ?? 50),
      minBasicSharePercent: String(guard.minBasicSharePercent ?? 75),
      mustStayAboveUmk: guard.mustStayAboveUmk ?? true,
      umkNominal: guard.umkNominal ? String(guard.umkNominal) : "",
    });
  }, [guard?.id]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Batas Aman Potongan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Maks potongan (% bruto)</Label>
              <Input
                type="number"
                min={0}
                max={50}
                value={guardForm.maxDeductionPercent}
                onChange={(e) =>
                  setGuardForm({
                    ...guardForm,
                    maxDeductionPercent: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Min gaji pokok (% bruto)</Label>
              <Input
                value={guardForm.minBasicSharePercent}
                onChange={(e) =>
                  setGuardForm({
                    ...guardForm,
                    minBasicSharePercent: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>UMK (opsional)</Label>
              <Input
                value={guardForm.umkNominal}
                onChange={(e) =>
                  setGuardForm({ ...guardForm, umkNominal: e.target.value })
                }
              />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <Switch
                checked={guardForm.mustStayAboveUmk}
                onCheckedChange={(v) =>
                  setGuardForm({ ...guardForm, mustStayAboveUmk: v })
                }
              />
              Tidak boleh di bawah UMK
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Seluruh potongan dari satu pembayaran upah paling banyak 50% (PP
            36/2021 Ps. 65). Batas itu berlaku walau baris ini belum disimpan.
          </p>
          <Button
            disabled={upsertGuard.isPending}
            onClick={async () => {
              try {
                await upsertGuard.mutateAsync({
                  unitId: scope?.unitId ?? null,
                  maxDeductionPercent: Number(guardForm.maxDeductionPercent),
                  minBasicSharePercent: Number(guardForm.minBasicSharePercent),
                  mustStayAboveUmk: guardForm.mustStayAboveUmk,
                  umkNominal: guardForm.umkNominal
                    ? Number(guardForm.umkNominal)
                    : null,
                  isActive: true,
                });
                toast.success("Batas potongan disimpan");
              } catch {
                // The API client already shows the server's reason.
              }
            }}
          >
            Simpan
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aturan Potongan Kehadiran</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Potongan selalu diambil dari sisi tunjangan, bukan gaji pokok.
            Aturan hanya berlaku setelah diaktifkan dan dasar hukumnya diisi.
          </p>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Kode</Label>
              <Input
                value={draft.code ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, code: e.target.value.toUpperCase() })
                }
                placeholder="POTONGAN_TELAT"
              />
            </div>
            <div className="space-y-2">
              <Label>Jenis</Label>
              <Select
                value={draft.kind}
                onValueChange={(v) =>
                  setDraft({ ...draft, kind: v as "EARNING" | "DEDUCTION" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEDUCTION">Potongan</SelectItem>
                  <SelectItem value="EARNING">Tambahan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Pemicu</Label>
              <Select
                value={draft.trigger}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    trigger: v as PayrollPolicyRule["trigger"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Dasar hitung</Label>
              <Input
                value={draft.basis ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, basis: e.target.value.toUpperCase() })
                }
                placeholder="TUNJANGAN / TUNJ_TRANSPORT / UPAH_SEHARI"
              />
            </div>
            <div className="space-y-2">
              <Label>Metode</Label>
              <Select
                value={draft.mode}
                onValueChange={(v) =>
                  setDraft({ ...draft, mode: v as PayrollPolicyRule["mode"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nilai / rasio</Label>
              <Input
                value={draft.rate ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    rate: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="0.01 atau 25000"
              />
            </div>
            <div className="space-y-2">
              <Label>Satuan</Label>
              <Select
                value={draft.unit}
                onValueChange={(v) =>
                  setDraft({ ...draft, unit: v as PayrollPolicyRule["unit"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PER_KEJADIAN">Per kejadian</SelectItem>
                  <SelectItem value="PER_HARI">Per hari</SelectItem>
                  <SelectItem value="PER_MENIT">Per menit</SelectItem>
                  <SelectItem value="PER_BULAN">Per bulan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Dasar hukum</Label>
              <Input
                value={draft.legalBasisDoc ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, legalBasisDoc: e.target.value })
                }
                placeholder="Peraturan Kepegawaian pasal …"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={draft.isActive ?? false}
              onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
            />
            Aktifkan aturan ini
          </label>
          <Button
            disabled={upsertRule.isPending || !draft.code}
            onClick={async () => {
              try {
                await upsertRule.mutateAsync({
                  ...draft,
                  unitId: scope?.unitId ?? null,
                });
                toast.success("Aturan disimpan");
                setDraft(emptyRule);
              } catch {
                // The API client already shows the server's reason.
              }
            }}
          >
            Simpan Aturan
          </Button>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Pemicu</TableHead>
                <TableHead>Dasar</TableHead>
                <TableHead>Metode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules?.length ? (
                rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.code}</TableCell>
                    <TableCell>{rule.trigger}</TableCell>
                    <TableCell>{rule.basis}</TableCell>
                    <TableCell>{rule.mode}</TableCell>
                    <TableCell>
                      {rule.isActive ? (
                        <Badge>Aktif</Badge>
                      ) : (
                        <Badge variant="secondary">Nonaktif</Badge>
                      )}
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft(rule)}
                      >
                        Ubah
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRule.mutate(rule.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Belum ada aturan potongan.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
