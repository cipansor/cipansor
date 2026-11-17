"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Sparkles,
  Calendar as CalendarIcon,
  CheckCircle,
  Circle,
  Star,
  Flame,
  ArrowLeft,
  Save,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  useIbadahTargets,
  useDailyCheckIn,
  useIbadahRecords,
  IBADAH_CATEGORIES,
  getCategoryInfo,
  getTargetUnitLabel,
  type IbadahTarget,
} from "@/hooks/use-ibadah";
import { useUnits } from "@/hooks/use-units";
import { useStudents } from "@/hooks/use-students";
import { cn } from "@/lib/utils";

interface CheckInItem {
  targetId: string;
  isCompleted: boolean;
  actualCount: number;
  actualMinutes?: number;
  notes: string;
}

export default function IbadahCheckInPage() {
  const router = useRouter();
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [selectedStudent, setSelectedStudent] = useState<string>("");
  const [date, setDate] = useState<Date>(new Date());
  const [checkIns, setCheckIns] = useState<Map<string, CheckInItem>>(new Map());

  // Queries
  const { data: units = [] } = useUnits({ limit: 100 });

  const { data: studentsData } = useStudents({
    unitId: selectedUnit || undefined,
    limit: 500,
  });
  const students = studentsData?.data || [];

  const { data: targetsData, isLoading: targetsLoading } = useIbadahTargets({
    unitId: selectedUnit || undefined,
    isActive: true,
    limit: 100,
  });
  const targets = targetsData?.data || [];

  // Check existing records for this date
  const { data: existingRecords } = useIbadahRecords({
    studentId: selectedStudent || undefined,
    date: format(date, "yyyy-MM-dd"),
    limit: 100,
  });

  // Mutation
  const dailyCheckIn = useDailyCheckIn();

  // Group targets by category
  const targetsByCategory = useMemo(() => {
    const grouped = new Map<string, IbadahTarget[]>();
    targets.forEach((target) => {
      const list = grouped.get(target.category) || [];
      list.push(target);
      grouped.set(target.category, list);
    });
    return grouped;
  }, [targets]);

  // Initialize checkIns when targets or existing records change
  useEffect(() => {
    if (targets.length > 0 && checkIns.size === 0) {
      const initial = new Map<string, CheckInItem>();
      targets.forEach((target) => {
        // Check if there's an existing record for this target
        const existingRecord = existingRecords?.data?.find(
          (r) => r.targetId === target.id,
        );

        initial.set(target.id, {
          targetId: target.id,
          isCompleted: existingRecord?.isCompleted || false,
          actualCount: existingRecord?.actualCount || 0,
          actualMinutes: existingRecord?.actualMinutes,
          notes: existingRecord?.notes || "",
        });
      });
      setCheckIns(initial);
    }
  }, [targets, existingRecords, checkIns.size]);

  const handleToggleComplete = (targetId: string, target: IbadahTarget) => {
    const current = checkIns.get(targetId);
    if (!current) return;

    const isCompleted = !current.isCompleted;
    setCheckIns(
      new Map(
        checkIns.set(targetId, {
          ...current,
          isCompleted,
          actualCount: isCompleted ? target.targetCount : 0,
        }),
      ),
    );
  };

  const handleCountChange = (targetId: string, count: number) => {
    const current = checkIns.get(targetId);
    if (!current) return;

    const target = targets.find((t) => t.id === targetId);
    setCheckIns(
      new Map(
        checkIns.set(targetId, {
          ...current,
          actualCount: count,
          isCompleted: target ? count >= target.targetCount : count > 0,
        }),
      ),
    );
  };

  const handleNotesChange = (targetId: string, notes: string) => {
    const current = checkIns.get(targetId);
    if (!current) return;

    setCheckIns(
      new Map(
        checkIns.set(targetId, {
          ...current,
          notes,
        }),
      ),
    );
  };

  const handleSubmit = async () => {
    if (!selectedStudent || !selectedUnit) {
      toast.error("Pilih santri terlebih dahulu");
      return;
    }

    const checkInsArray = Array.from(checkIns.values()).filter(
      (item) => item.isCompleted || item.actualCount > 0,
    );

    if (checkInsArray.length === 0) {
      toast.error("Minimal satu ibadah harus dicatat");
      return;
    }

    try {
      const result = await dailyCheckIn.mutateAsync({
        studentId: selectedStudent,
        unitId: selectedUnit,
        date: format(date, "yyyy-MM-dd"),
        checkIns: checkInsArray,
      });

      toast.success(
        `Check-in berhasil! Total ${result.totalPointsToday} poin hari ini. Streak: ${result.streak} hari 🔥`,
      );
      router.push("/ibadah");
    } catch {
      toast.error("Gagal menyimpan check-in");
    }
  };

  // Calculate stats
  const completedCount = Array.from(checkIns.values()).filter(
    (c) => c.isCompleted,
  ).length;
  const totalTargets = targets.length;
  const totalPoints = Array.from(checkIns.entries()).reduce(
    (sum, [targetId, item]) => {
      if (!item.isCompleted) return sum;
      const target = targets.find((t) => t.id === targetId);
      return sum + (target?.points || 0);
    },
    0,
  );

  return (
    <MainLayout>
      <PageHeader
        title="Check-in Ibadah Harian"
        description="Catat ibadah harian santri"
      />

      <div className="flex items-center gap-2 mb-6">
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Kembali
        </Button>
      </div>

      {/* Selection Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Pilih Santri & Tanggal</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Unit</Label>
              <Select
                value={selectedUnit}
                onValueChange={(v) => {
                  setSelectedUnit(v);
                  setSelectedStudent("");
                  setCheckIns(new Map());
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Unit" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Santri</Label>
              <Select
                value={selectedStudent}
                onValueChange={setSelectedStudent}
                disabled={!selectedUnit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Santri" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.name} ({student.nis})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tanggal</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {format(date, "EEEE, dd MMMM yyyy", { locale: localeId })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    locale={localeId}
                    disabled={(d) => d > new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Summary */}
      {selectedStudent && (
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Selesai</p>
                  <p className="text-2xl font-bold text-green-600">
                    {completedCount}/{totalTargets}
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-950 dark:to-yellow-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Poin</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {totalPoints}
                  </p>
                </div>
                <Star className="h-8 w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Progress</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {totalTargets > 0
                      ? Math.round((completedCount / totalTargets) * 100)
                      : 0}
                    %
                  </p>
                </div>
                <Flame className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Check-in Items by Category */}
      {selectedStudent && (
        <div className="space-y-6">
          {targetsLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-32" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <Skeleton key={j} className="h-16 w-full" />
                    ))}
                  </CardContent>
                </Card>
              ))
            : IBADAH_CATEGORIES.map((category) => {
                const categoryTargets =
                  targetsByCategory.get(category.value) || [];
                if (categoryTargets.length === 0) return null;

                return (
                  <Card key={category.value}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{category.icon}</span>
                        <div>
                          <CardTitle className="text-lg">
                            {category.label}
                          </CardTitle>
                          <CardDescription className="font-arabic">
                            {category.labelAr}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {categoryTargets.map((target) => {
                        const checkIn = checkIns.get(target.id);
                        const progress = checkIn
                          ? (checkIn.actualCount / target.targetCount) * 100
                          : 0;

                        return (
                          <div
                            key={target.id}
                            className={cn(
                              "p-4 rounded-lg border transition-all",
                              checkIn?.isCompleted
                                ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
                                : "bg-card hover:border-primary/50",
                            )}
                          >
                            <div className="flex items-start gap-4">
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleComplete(target.id, target)
                                }
                                className="mt-1"
                              >
                                {checkIn?.isCompleted ? (
                                  <CheckCircle className="h-6 w-6 text-green-500" />
                                ) : (
                                  <Circle className="h-6 w-6 text-muted-foreground hover:text-primary" />
                                )}
                              </button>

                              <div className="flex-1 space-y-3">
                                <div className="flex items-start justify-between">
                                  <div>
                                    <h4 className="font-medium">
                                      {target.name}
                                    </h4>
                                    {target.nameAr && (
                                      <p className="text-sm text-muted-foreground font-arabic">
                                        {target.nameAr}
                                      </p>
                                    )}
                                    {target.description && (
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {target.description}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Star className="h-4 w-4 text-yellow-500" />
                                    <span className="font-medium">
                                      {target.points}
                                    </span>
                                  </div>
                                </div>

                                {/* Progress Slider */}
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-sm">
                                    <span>
                                      {checkIn?.actualCount || 0} /{" "}
                                      {target.targetCount}{" "}
                                      {getTargetUnitLabel(
                                        target.targetUnit,
                                      ).toLowerCase()}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {Math.round(progress)}%
                                    </span>
                                  </div>
                                  <Slider
                                    value={[checkIn?.actualCount || 0]}
                                    max={target.targetCount}
                                    step={1}
                                    onValueChange={([value]) =>
                                      handleCountChange(target.id, value)
                                    }
                                    className="w-full"
                                  />
                                </div>

                                {/* Notes */}
                                <Input
                                  placeholder="Catatan (opsional)"
                                  value={checkIn?.notes || ""}
                                  onChange={(e) =>
                                    handleNotesChange(target.id, e.target.value)
                                  }
                                  className="text-sm"
                                />

                                {/* Optional badge */}
                                {target.isOptional && (
                                  <Badge variant="outline" className="text-xs">
                                    Opsional
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}

          {/* Submit Button */}
          <div className="flex justify-end gap-4 pt-4">
            <Button variant="outline" onClick={() => router.back()}>
              Batal
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={dailyCheckIn.isPending || completedCount === 0}
            >
              {dailyCheckIn.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Simpan Check-in
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {!selectedStudent && selectedUnit && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Pilih santri untuk memulai check-in ibadah harian</p>
          </CardContent>
        </Card>
      )}

      {!selectedUnit && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Pilih unit terlebih dahulu</p>
          </CardContent>
        </Card>
      )}
    </MainLayout>
  );
}
