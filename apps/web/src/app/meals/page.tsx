"use client";

import { useState, useMemo } from "react";
import { safeFormat } from "@/lib/date";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useTodayMenus,
  useWeeklyMenus,
  useMealStats,
  MealMenu,
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  MealType,
} from "@/hooks/use-meals";
import { useUnits } from "@/hooks/use-units";
import {
  UtensilsCrossed,
  Calendar,
  Sun,
  Sunset,
  Moon,
  Coffee,
  Plus,
  ChevronLeft,
  ChevronRight,
  Users,
  Flame,
  Leaf,
  Fish,
  Drumstick,
  Apple,
  Soup,
  GlassWater,
  Clock,
  Building2,
  Printer,
} from "lucide-react";
import {
  format,
  addDays,
  startOfWeek,
  endOfWeek,
  isToday,
  parseISO,
} from "date-fns";
import { id } from "date-fns/locale";
import { toast } from "sonner";
import Link from "next/link";

const MEAL_ICONS: Record<MealType, React.ReactNode> = {
  BREAKFAST: <Sun className="h-5 w-5" />,
  LUNCH: <Sunset className="h-5 w-5" />,
  DINNER: <Moon className="h-5 w-5" />,
  SNACK: <Coffee className="h-5 w-5" />,
};

const MEAL_COLORS: Record<MealType, string> = {
  BREAKFAST: "bg-amber-50 border-amber-200 text-amber-800",
  LUNCH: "bg-orange-50 border-orange-200 text-orange-800",
  DINNER: "bg-indigo-50 border-indigo-200 text-indigo-800",
  SNACK: "bg-green-50 border-green-200 text-green-800",
};

const MEAL_TIMES: Record<MealType, string> = {
  BREAKFAST: "06:30 - 07:00",
  LUNCH: "12:00 - 12:30",
  DINNER: "18:30 - 19:00",
  SNACK: "15:00 - 15:30",
};

function MealCard({ menu, mealType }: { menu?: MealMenu; mealType: MealType }) {
  return (
    <Card className={`${menu ? MEAL_COLORS[mealType] : "bg-gray-50"} border`}>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {MEAL_ICONS[mealType]}
            <CardTitle className="text-base">
              {MEAL_TYPE_LABELS[mealType]}
            </CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {MEAL_TIMES[mealType]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {menu ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Drumstick className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
              <span className="font-medium">{menu.mainDish}</span>
            </div>
            {menu.sideDish && (
              <div className="flex items-start gap-2">
                <Fish className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                <span>{menu.sideDish}</span>
              </div>
            )}
            {menu.vegetable && (
              <div className="flex items-start gap-2">
                <Leaf className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                <span>{menu.vegetable}</span>
              </div>
            )}
            {menu.soup && (
              <div className="flex items-start gap-2">
                <Soup className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                <span>{menu.soup}</span>
              </div>
            )}
            {menu.dessert && (
              <div className="flex items-start gap-2">
                <Apple className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                <span>{menu.dessert}</span>
              </div>
            )}
            {menu.drink && (
              <div className="flex items-start gap-2">
                <GlassWater className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
                <span>{menu.drink}</span>
              </div>
            )}
            {menu.calories && (
              <div className="flex items-center gap-2 pt-2 border-t mt-2">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-xs">{menu.calories} kkal</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Belum ada menu</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MealsPage() {
  const [selectedUnitId, setSelectedUnitId] = useState<string>("ALL");
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );

  const { data: units = [] } = useUnits();
  const unitId = selectedUnitId === "ALL" ? undefined : selectedUnitId;
  const { data: todayMenus, isLoading: todayLoading } = useTodayMenus(unitId);
  const { data: weeklyMenus = [], isLoading: weeklyLoading } = useWeeklyMenus({
    unitId,
    weekStart: format(currentWeekStart, "yyyy-MM-dd"),
  });

  // Generate week days
  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(currentWeekStart, i));
    }
    return days;
  }, [currentWeekStart]);

  // Group menus by day and meal type
  const menusByDayAndType = useMemo(() => {
    const grouped: Record<string, Record<MealType, MealMenu | undefined>> = {};

    weekDays.forEach((day) => {
      const dateKey = format(day, "yyyy-MM-dd");
      grouped[dateKey] = {
        BREAKFAST: undefined,
        LUNCH: undefined,
        DINNER: undefined,
        SNACK: undefined,
      };
    });

    (weeklyMenus || []).forEach((menu) => {
      const dateKey = menu.date;
      if (grouped[dateKey]) {
        grouped[dateKey][menu.mealType] = menu;
      }
    });

    return grouped;
  }, [weekDays, weeklyMenus]);

  const navigateWeek = (direction: "prev" | "next") => {
    setCurrentWeekStart((prev) =>
      direction === "next" ? addDays(prev, 7) : addDays(prev, -7),
    );
  };

  const handlePrint = () => {
    window.print();
    toast.success("Menu mingguan siap dicetak");
  };

  // Demo stats
  const stats = {
    totalStudents: 450,
    mealToday: {
      breakfast: { present: 420, absent: 30 },
      lunch: { present: 445, absent: 5 },
      dinner: { present: 438, absent: 12 },
    },
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UtensilsCrossed className="h-6 w-6 text-primary" />
              Manajemen Menu Makan
            </h1>
            <p className="text-muted-foreground">
              Kelola menu makanan harian untuk santri/siswa
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Cetak Menu
            </Button>
            <Button asChild>
              <Link href="/meals/menus/new">
                <Plus className="h-4 w-4 mr-2" />
                Tambah Menu
              </Link>
            </Button>
          </div>
        </div>

        {/* Unit Filter */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-2 block">Unit</label>
                <Select
                  value={selectedUnitId}
                  onValueChange={setSelectedUnitId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Unit</SelectItem>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Stats */}
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">
                    {stats.mealToday.breakfast.present}
                  </p>
                  <p className="text-xs text-muted-foreground">Sarapan</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-orange-600">
                    {stats.mealToday.lunch.present}
                  </p>
                  <p className="text-xs text-muted-foreground">Makan Siang</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-indigo-600">
                    {stats.mealToday.dinner.present}
                  </p>
                  <p className="text-xs text-muted-foreground">Makan Malam</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="today" className="space-y-4">
          <TabsList>
            <TabsTrigger value="today" className="gap-2">
              <Sun className="h-4 w-4" />
              Menu Hari Ini
            </TabsTrigger>
            <TabsTrigger value="weekly" className="gap-2">
              <Calendar className="h-4 w-4" />
              Menu Mingguan
            </TabsTrigger>
          </TabsList>

          {/* Today's Menu */}
          <TabsContent value="today" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {safeFormat(new Date(), "EEEE, d MMMM yyyy", { locale: id })}
              </h2>
              <Badge className="bg-emerald-100 text-emerald-800">
                Hari Ini
              </Badge>
            </div>

            {!unitId ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                  <Building2 className="h-8 w-8 opacity-30" />
                  <p className="text-sm">
                    Pilih satu unit untuk melihat menu hari ini.
                  </p>
                </CardContent>
              </Card>
            ) : todayLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-[200px]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {MEAL_TYPES.map((mealType) => (
                  <MealCard
                    key={mealType}
                    mealType={mealType}
                    menu={
                      todayMenus?.[
                        mealType.toLowerCase() as keyof typeof todayMenus
                      ]
                    }
                  />
                ))}
              </div>
            )}

            {/* Attendance Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Kehadiran Makan Hari Ini
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-4 p-4 bg-amber-50 rounded-lg">
                    <Sun className="h-8 w-8 text-amber-600" />
                    <div>
                      <p className="text-2xl font-bold">
                        {stats.mealToday.breakfast.present}/
                        {stats.totalStudents}
                      </p>
                      <p className="text-sm text-muted-foreground">Sarapan</p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-xs text-red-600">
                        -{stats.mealToday.breakfast.absent}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Tidak hadir
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-4 bg-orange-50 rounded-lg">
                    <Sunset className="h-8 w-8 text-orange-600" />
                    <div>
                      <p className="text-2xl font-bold">
                        {stats.mealToday.lunch.present}/{stats.totalStudents}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Makan Siang
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-xs text-red-600">
                        -{stats.mealToday.lunch.absent}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Tidak hadir
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 p-4 bg-indigo-50 rounded-lg">
                    <Moon className="h-8 w-8 text-indigo-600" />
                    <div>
                      <p className="text-2xl font-bold">
                        {stats.mealToday.dinner.present}/{stats.totalStudents}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Makan Malam
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-xs text-red-600">
                        -{stats.mealToday.dinner.absent}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Tidak hadir
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Weekly Menu */}
          <TabsContent value="weekly" className="space-y-4">
            {/* Week Navigation */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigateWeek("prev")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-semibold">
                {format(currentWeekStart, "d MMM", { locale: id })} -{" "}
                {format(
                  endOfWeek(currentWeekStart, { weekStartsOn: 1 }),
                  "d MMM yyyy",
                  { locale: id },
                )}
              </h2>
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigateWeek("next")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Weekly Grid */}
            {weeklyLoading ? (
              <Skeleton className="h-[600px] w-full" />
            ) : (
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full border-collapse min-w-[900px]">
                  <thead>
                    <tr>
                      <th className="border border-gray-300 bg-gray-50 p-3 text-left font-semibold w-[100px]">
                        Waktu
                      </th>
                      {weekDays.map((day) => (
                        <th
                          key={day.toISOString()}
                          className={`border border-gray-300 p-3 text-center font-semibold ${
                            isToday(day) ? "bg-emerald-100" : "bg-gray-50"
                          }`}
                        >
                          <div>{format(day, "EEEE", { locale: id })}</div>
                          <div className="text-sm font-normal text-muted-foreground">
                            {format(day, "d MMM", { locale: id })}
                          </div>
                          {isToday(day) && (
                            <Badge className="bg-emerald-600 text-white text-[10px] mt-1">
                              Hari Ini
                            </Badge>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["BREAKFAST", "LUNCH", "DINNER"] as MealType[]).map(
                      (mealType) => (
                        <tr key={mealType}>
                          <td
                            className={`border border-gray-300 p-3 ${MEAL_COLORS[mealType]}`}
                          >
                            <div className="flex items-center gap-2">
                              {MEAL_ICONS[mealType]}
                              <div>
                                <div className="font-medium">
                                  {MEAL_TYPE_LABELS[mealType]}
                                </div>
                                <div className="text-xs opacity-75">
                                  {MEAL_TIMES[mealType]}
                                </div>
                              </div>
                            </div>
                          </td>
                          {weekDays.map((day) => {
                            const dateKey = format(day, "yyyy-MM-dd");
                            const menu = menusByDayAndType[dateKey]?.[mealType];

                            return (
                              <td
                                key={`${dateKey}-${mealType}`}
                                className={`border border-gray-300 p-2 align-top ${
                                  isToday(day) ? "bg-emerald-50" : ""
                                }`}
                              >
                                {menu ? (
                                  <div className="text-xs space-y-1">
                                    <p className="font-semibold">
                                      {menu.mainDish}
                                    </p>
                                    {menu.sideDish && (
                                      <p className="text-muted-foreground">
                                        {menu.sideDish}
                                      </p>
                                    )}
                                    {menu.vegetable && (
                                      <p className="text-muted-foreground">
                                        {menu.vegetable}
                                      </p>
                                    )}
                                    {menu.soup && (
                                      <p className="text-muted-foreground">
                                        {menu.soup}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-center text-muted-foreground py-2">
                                    <span className="text-xs">-</span>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Nutrition Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" />
                  Informasi Nutrisi
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-muted-foreground">
                      Rata-rata Kalori/Hari
                    </p>
                    <p className="text-xl font-bold">1,650 kkal</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-muted-foreground">Protein</p>
                    <p className="text-xl font-bold">55g</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-muted-foreground">Karbohidrat</p>
                    <p className="text-xl font-bold">220g</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-muted-foreground">Lemak</p>
                    <p className="text-xl font-bold">45g</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Print Styles */}
        <style jsx global>{`
          @media print {
            body * {
              visibility: hidden;
            }
            .print\\:overflow-visible,
            .print\\:overflow-visible * {
              visibility: visible;
            }
          }
        `}</style>
      </div>
    </MainLayout>
  );
}
