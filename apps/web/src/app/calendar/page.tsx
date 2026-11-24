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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useMonthEvents,
  CalendarEvent,
  EVENT_CATEGORIES,
  getEventCategoryConfig,
  EventCategory,
} from "@/hooks/use-calendar";
import { useUnits } from "@/hooks/use-units";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Clock,
  Users,
  GraduationCap,
  BookOpen,
  Trophy,
  FileText,
  MoreHorizontal,
  Filter,
  List,
  Grid3X3,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from "date-fns";
import { id as idLocale } from "date-fns/locale";
import Link from "next/link";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  GraduationCap,
  BookOpen,
  Trophy,
  Calendar: CalendarIcon,
  Users,
  FileText,
  MoreHorizontal,
};

export default function AcademicCalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<EventCategory | "">(
    "",
  );
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");

  const { data: units = [] } = useUnits();
  const { data: events = [], isLoading } = useMonthEvents(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    selectedUnitId || undefined,
  );

  // Filter events by category
  const filteredEvents = useMemo(() => {
    if (!selectedCategory) return events;
    return events.filter((e) => e.eventType === selectedCategory);
  }, [events, selectedCategory]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });

    const days: Date[] = [];
    let day = startDate;
    while (day <= endDate) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentDate]);

  // Get events for a specific day
  const getEventsForDay = (date: Date): CalendarEvent[] => {
    const dateStr = format(date, "yyyy-MM-dd");
    return filteredEvents.filter((event) => {
      const eventStart = event.startDate.slice(0, 10);
      // A one-day event has no `endDate`: it occupies its start day only.
      const eventEnd = event.endDate ? event.endDate.slice(0, 10) : eventStart;
      return dateStr >= eventStart && dateStr <= eventEnd;
    });
  };

  const handlePrevMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarIcon className="h-6 w-6 text-primary" />
              Kalender Akademik
            </h1>
            <p className="text-muted-foreground">
              Jadwal kegiatan dan event pesantren
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/calendar/events/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Tambah Event
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters & Controls */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              {/*
                This row already stacked at md:, and still ran 15px past a
                390px screen — the cause is the fixed w-48 month label, not the
                direction. Two arrows, a 192px label, "Hari Ini" and the card's
                own padding come to about 422px. Narrower below sm:, and allowed
                to wrap, so a long month name ("September 2026") drops instead of
                pushing the arrows off.
              */}
              <div className="flex flex-wrap items-center gap-4">
                {/* Month Navigation */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrevMonth}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="w-36 text-center sm:w-48">
                    <h2 className="text-lg font-semibold">
                      {format(currentDate, "MMMM yyyy", { locale: idLocale })}
                    </h2>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleNextMonth}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={handleToday}>
                  Hari Ini
                </Button>
              </div>

              {/*
                The other half of the toolbar: a 160px unit filter beside the
                calendar/list view switcher. Together they still ran 15px past a
                390px screen after the month label was narrowed, so this row wraps
                too — the switcher drops under the filter rather than off the edge.
              */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Unit Filter */}
                <Select
                  value={selectedUnitId || "all"}
                  onValueChange={(v) => setSelectedUnitId(v === "all" ? "" : v)}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Semua Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Unit</SelectItem>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Category Filter */}
                <Select
                  value={selectedCategory || "all"}
                  onValueChange={(v) =>
                    setSelectedCategory(v === "all" ? "" : (v as EventCategory))
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {EVENT_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: cat.color }}
                          />
                          {cat.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* View Toggle */}
                <div className="flex items-center border rounded-lg">
                  <Button
                    variant={viewMode === "calendar" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("calendar")}
                    className="rounded-r-none"
                  >
                    <Grid3X3 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("list")}
                    className="rounded-l-none"
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Category Legend */}
        <div className="flex flex-wrap gap-2">
          {EVENT_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() =>
                setSelectedCategory(
                  selectedCategory === cat.value ? "" : cat.value,
                )
              }
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all
                ${selectedCategory === cat.value ? "ring-2 ring-offset-2" : "opacity-80 hover:opacity-100"}
              `}
              style={{
                backgroundColor: `${cat.color}20`,
                color: cat.color,
                ...(selectedCategory === cat.value && {
                  boxShadow: `0 0 0 2px white, 0 0 0 4px ${cat.color}`,
                }),
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              {cat.label}
            </button>
          ))}
        </div>

        {/* Calendar View */}
        {viewMode === "calendar" ? (
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6">
                  <Skeleton className="h-[600px] w-full" />
                </div>
              ) : (
                <div className="overflow-hidden">
                  {/* Day Headers */}
                  <div className="grid grid-cols-7 border-b bg-muted/50">
                    {["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"].map(
                      (day, idx) => (
                        <div
                          key={day}
                          className={`p-3 text-center text-sm font-semibold ${idx === 0 || idx === 6 ? "text-red-500" : ""}`}
                        >
                          {day}
                        </div>
                      ),
                    )}
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day, idx) => {
                      const dayEvents = getEventsForDay(day);
                      const isCurrentMonth = isSameMonth(day, currentDate);
                      const isCurrentDay = isToday(day);
                      const dayOfWeek = day.getDay();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                      return (
                        <div
                          key={idx}
                          data-testid="calendar-day"
                          className={`
                            min-h-[120px] border-b border-r p-1 transition-colors
                            ${!isCurrentMonth ? "bg-muted/30 text-muted-foreground" : ""}
                            ${isCurrentDay ? "bg-primary/5" : ""}
                            hover:bg-muted/50
                          `}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span
                              className={`
                                text-sm w-7 h-7 flex items-center justify-center rounded-full
                                ${isCurrentDay ? "bg-primary text-primary-foreground font-bold" : ""}
                                ${isWeekend && !isCurrentDay ? "text-red-500" : ""}
                              `}
                            >
                              {format(day, "d")}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {dayEvents.slice(0, 3).map((event) => {
                              const catConfig = getEventCategoryConfig(
                                event.eventType,
                              );
                              return (
                                <button
                                  key={event.id}
                                  onClick={() => setSelectedEvent(event)}
                                  className="w-full text-left px-1.5 py-0.5 rounded text-xs truncate transition-opacity hover:opacity-80"
                                  style={{
                                    backgroundColor: `${catConfig?.color}20`,
                                    color: catConfig?.color,
                                    borderLeft: `3px solid ${catConfig?.color}`,
                                  }}
                                >
                                  {event.title}
                                </button>
                              );
                            })}
                            {dayEvents.length > 3 && (
                              <button
                                onClick={() => {
                                  /* Could open a modal with all events */
                                }}
                                className="text-xs text-muted-foreground hover:underline pl-1.5"
                              >
                                +{dayEvents.length - 3} lainnya
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          /* List View */
          <Card>
            <CardHeader>
              <CardTitle>
                Daftar Event Bulan{" "}
                {format(currentDate, "MMMM yyyy", { locale: idLocale })}
              </CardTitle>
              <CardDescription>
                {filteredEvents.length} event ditemukan
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Tidak ada event di bulan ini</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredEvents
                    .sort(
                      (a, b) =>
                        new Date(a.startDate).getTime() -
                        new Date(b.startDate).getTime(),
                    )
                    .map((event) => {
                      const catConfig = getEventCategoryConfig(event.eventType);
                      const Icon =
                        iconMap[catConfig?.icon || "Calendar"] || CalendarIcon;

                      return (
                        <div
                          key={event.id}
                          onClick={() => setSelectedEvent(event)}
                          className="flex items-start gap-4 p-4 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                          <div
                            className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                              backgroundColor: `${catConfig?.color}20`,
                              color: catConfig?.color,
                            }}
                          >
                            <Icon className="h-6 w-6" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h3 className="font-semibold">{event.title}</h3>
                                <p className="text-sm text-muted-foreground line-clamp-1">
                                  {event.description || "Tidak ada deskripsi"}
                                </p>
                              </div>
                              <Badge className={catConfig?.bgColor}>
                                {catConfig?.label}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <CalendarIcon className="h-3.5 w-3.5" />
                                {safeFormat(
                                  new Date(event.startDate),
                                  "d MMM",
                                  {
                                    locale: idLocale,
                                  },
                                )}
                                {event.endDate &&
                                  event.startDate.slice(0, 10) !==
                                    event.endDate.slice(0, 10) && (
                                    <>
                                      {" "}
                                      -{" "}
                                      {safeFormat(
                                        new Date(event.endDate),
                                        "d MMM",
                                        {
                                          locale: idLocale,
                                        },
                                      )}
                                    </>
                                  )}
                              </span>
                              {!event.isAllDay && event.startTime && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  {event.startTime}
                                  {event.endTime && <> - {event.endTime}</>}
                                </span>
                              )}
                              {event.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" />
                                  {event.location}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Upcoming Events Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Statistik Event Bulan Ini</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {EVENT_CATEGORIES.slice(0, 4).map((cat) => {
                  const count = filteredEvents.filter(
                    (e) => e.eventType === cat.value,
                  ).length;
                  const Icon = iconMap[cat.icon] || CalendarIcon;

                  return (
                    <div
                      key={cat.value}
                      className="p-4 rounded-lg text-center"
                      style={{ backgroundColor: `${cat.color}10` }}
                    >
                      <div
                        className="h-8 w-8 mx-auto mb-2"
                        style={{ color: cat.color }}
                      >
                        <Icon className="h-8 w-8" />
                      </div>
                      <p
                        className="text-2xl font-bold"
                        style={{ color: cat.color }}
                      >
                        {count}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {cat.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Event Mendatang</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredEvents
                .filter((e) => new Date(e.startDate) >= new Date())
                .slice(0, 5)
                .map((event) => {
                  const catConfig = getEventCategoryConfig(event.eventType);
                  return (
                    <div
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer mb-2 last:mb-0"
                    >
                      <div
                        className="w-2 h-10 rounded-full"
                        style={{ backgroundColor: catConfig?.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">
                          {event.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {safeFormat(new Date(event.startDate), "d MMM yyyy", {
                            locale: idLocale,
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              {filteredEvents.filter((e) => new Date(e.startDate) >= new Date())
                .length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Tidak ada event mendatang
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Event Detail Dialog */}
        <Dialog
          open={!!selectedEvent}
          onOpenChange={() => setSelectedEvent(null)}
        >
          <DialogContent className="sm:max-w-lg">
            {selectedEvent && (
              <>
                <DialogHeader>
                  <div className="flex items-start gap-3">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${getEventCategoryConfig(selectedEvent.eventType)?.color}20`,
                        color: getEventCategoryConfig(selectedEvent.eventType)
                          ?.color,
                      }}
                    >
                      {(() => {
                        const catConfig = getEventCategoryConfig(
                          selectedEvent.eventType,
                        );
                        const Icon =
                          iconMap[catConfig?.icon || "Calendar"] ||
                          CalendarIcon;
                        return <Icon className="h-6 w-6" />;
                      })()}
                    </div>
                    <div className="flex-1">
                      <DialogTitle>{selectedEvent.title}</DialogTitle>
                      <Badge
                        className={
                          getEventCategoryConfig(selectedEvent.eventType)
                            ?.bgColor
                        }
                      >
                        {getEventCategoryConfig(selectedEvent.eventType)?.label}
                      </Badge>
                    </div>
                  </div>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  {selectedEvent.description && (
                    <p className="text-muted-foreground">
                      {selectedEvent.description}
                    </p>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {format(
                          new Date(selectedEvent.startDate),
                          "d MMMM yyyy",
                          { locale: idLocale },
                        )}
                        {selectedEvent.endDate &&
                          selectedEvent.startDate.slice(0, 10) !==
                            selectedEvent.endDate.slice(0, 10) && (
                            <>
                              {" "}
                              -{" "}
                              {format(
                                new Date(selectedEvent.endDate),
                                "d MMMM yyyy",
                                { locale: idLocale },
                              )}
                            </>
                          )}
                      </span>
                    </div>

                    {!selectedEvent.isAllDay && selectedEvent.startTime && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {selectedEvent.startTime}
                          {selectedEvent.endTime && (
                            <> - {selectedEvent.endTime}</>
                          )}
                        </span>
                      </div>
                    )}

                    {selectedEvent.location && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedEvent.location}</span>
                      </div>
                    )}

                    {selectedEvent.unit && (
                      <div className="flex items-center gap-2 text-sm">
                        <GraduationCap className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedEvent.unit.name}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setSelectedEvent(null)}
                    >
                      Tutup
                    </Button>
                    <Link href={`/calendar/events/${selectedEvent.id}/edit`}>
                      <Button variant="default">Edit Event</Button>
                    </Link>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
