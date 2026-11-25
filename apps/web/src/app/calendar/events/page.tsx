"use client";
import { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useCalendarEvents,
  useDeleteCalendarEvent,
  EVENT_CATEGORIES,
  getEventCategoryConfig,
  EventCategory,
  CalendarEvent,
} from "@/hooks/use-calendar";
import { Pagination } from "@/components/shared/pagination";
import { useCanWriteCalendar } from "@/hooks/use-calendar-permissions";
import { useAuth } from "@/hooks/use-auth";
import { canModifyCalendarEvent } from "@/lib/calendar-access";
import {
  CALENDAR_EVENT_SEARCH_MAX_LENGTH,
  type CalendarEventDeleteScope,
} from "@cipansor/shared";
import {
  Calendar as CalendarIcon,
  Plus,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  MapPin,
  Clock,
  Filter,
} from "lucide-react";

import { id as idLocale } from "date-fns/locale";
import Link from "next/link";
import { toast } from "sonner";

export default function EventsListPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // `all` rather than "": Radix Select refuses an empty-string item, so the
  // "Semua Kategori" option could not be rendered at all.
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | "all">(
    "all",
  );
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
  const [deleteScope, setDeleteScope] =
    useState<CalendarEventDeleteScope>("SINGLE");

  const {
    data: eventsData,
    isLoading,
    isError,
    refetch,
  } = useCalendarEvents({
    page,
    limit: 50,
    // Search runs on the server, before pagination: filtering the 50 rows the
    // browser already has hid an agenda that fell on a later page.
    search: search.trim() || undefined,
    // The API's own filter name. The page used to send `category`, which the
    // controller never read, so choosing a category filtered nothing (#1155).
    eventType: categoryFilter === "all" ? undefined : categoryFilter,
    manage: true,
  });
  const events = eventsData?.data || [];
  const total = eventsData?.meta.total ?? 0;
  const canManage = useCanWriteCalendar();
  const { user } = useAuth();

  // Deleting the last row of the last page leaves the requested page beyond
  // the new total. The API answers an empty page, so without this the list said
  // "no events" and the pager (hidden at one page) offered no way back.
  useEffect(() => {
    if (eventsData && page > Math.max(1, eventsData.meta.totalPages)) {
      setPage(Math.max(1, eventsData.meta.totalPages));
    }
  }, [eventsData, page]);

  const deleteEvent = useDeleteCalendarEvent();

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEvent.mutateAsync({
        id: deleteTarget.id,
        scope: deleteScope,
      });
      toast.success(
        deleteScope === "SERIES"
          ? "Seluruh rangkaian agenda berhasil dihapus"
          : "Agenda berhasil dihapus",
      );
      setDeleteTarget(null);
    } catch {
      toast.error("Gagal menghapus agenda");
    }
  };

  /** Whether this row is part of a series, so the dialog can offer the choice. */
  const inSeries = (event: CalendarEvent) =>
    event.isRecurring || !!event.recurrenceParentId;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarIcon className="h-6 w-6 text-primary" />
              Manajemen Event
            </h1>
            <p className="text-muted-foreground">
              Kelola semua event dan kegiatan pesantren
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/calendar">
              <Button variant="outline">
                <CalendarIcon className="h-4 w-4 mr-2" />
                Lihat Kalender
              </Button>
            </Link>
            {canManage && (
              <Link href="/calendar/events/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Tambah Event
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={`Cari event... (maks. ${CALENDAR_EVENT_SEARCH_MAX_LENGTH} karakter)`}
                  maxLength={CALENDAR_EVENT_SEARCH_MAX_LENGTH}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                />
              </div>
              <Select
                value={categoryFilter}
                onValueChange={(v) => {
                  setCategoryFilter(v as EventCategory | "all");
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-48" aria-label="Saring kategori">
                  <Filter className="h-4 w-4 mr-2" />
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
            </div>
          </CardContent>
        </Card>

        {/* Events Table */}
        <Card>
          <CardHeader>
            <CardTitle>Daftar Event</CardTitle>
            <CardDescription>{total} event ditemukan</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : isError ? (
              <div
                role="alert"
                className="text-center py-12 text-muted-foreground"
              >
                <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Daftar agenda gagal dimuat.</p>
                <p className="text-sm">Periksa koneksi lalu coba lagi.</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => refetch()}
                >
                  Coba lagi
                </Button>
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Tidak ada event ditemukan</p>
                {canManage && (
                  <Link href="/calendar/events/new">
                    <Button variant="outline" className="mt-4">
                      <Plus className="h-4 w-4 mr-2" />
                      Buat Event Baru
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Lokasi</TableHead>
                    <TableHead className="w-20">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => {
                    const catConfig = getEventCategoryConfig(event.eventType);
                    return (
                      <TableRow key={event.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div
                              className="w-3 h-10 rounded-full shrink-0"
                              style={{ backgroundColor: catConfig?.color }}
                            />
                            <div>
                              <p className="font-medium">{event.title}</p>
                              {event.description && (
                                <p className="text-sm text-muted-foreground line-clamp-1 max-w-xs">
                                  {event.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={catConfig?.bgColor}>
                            {catConfig?.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {safeFormat(new Date(event.startDate), "d MMM", {
                              locale: idLocale,
                            })}
                            {event.endDate &&
                              event.startDate.slice(0, 10) !==
                                event.endDate.slice(0, 10) && (
                                <>
                                  {" "}
                                  -{" "}
                                  {safeFormat(
                                    new Date(event.endDate),
                                    "d MMM",
                                    { locale: idLocale },
                                  )}
                                </>
                              )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {event.isAllDay ? (
                            <Badge variant="outline">Sepanjang Hari</Badge>
                          ) : event.startTime ? (
                            <div className="flex items-center gap-1 text-sm">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              {event.startTime}
                              {event.endTime && <> - {event.endTime}</>}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {event.location ? (
                            <div className="flex items-center gap-1 text-sm max-w-[150px]">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate">{event.location}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <Link href={`/calendar/events/${event.id}`}>
                                <DropdownMenuItem>
                                  <Eye className="h-4 w-4 mr-2" />
                                  Lihat Detail
                                </DropdownMenuItem>
                              </Link>
                              {canManage &&
                                canModifyCalendarEvent(user, event) && (
                                  <>
                                    <Link
                                      href={`/calendar/events/${event.id}/edit`}
                                    >
                                      <DropdownMenuItem>
                                        <Edit className="h-4 w-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                    </Link>
                                    <DropdownMenuItem
                                      className="text-red-600"
                                      onClick={() => {
                                        setDeleteScope("SINGLE");
                                        setDeleteTarget(event);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Hapus
                                    </DropdownMenuItem>
                                  </>
                                )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {eventsData && eventsData.meta.totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={eventsData.meta.totalPages}
            pageSize={eventsData.meta.limit}
            total={eventsData.meta.total}
            onPageChange={setPage}
          />
        )}

        {/* Delete Confirmation */}
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Agenda?</AlertDialogTitle>
              <AlertDialogDescription>
                Agenda yang dihapus tidak dapat dikembalikan.
                {deleteTarget && inSeries(deleteTarget) && (
                  <>
                    {" "}
                    Agenda ini bagian dari rangkaian berulang — pilih apakah
                    hanya kemunculan ini atau seluruh rangkaian yang dihapus.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {deleteTarget && inSeries(deleteTarget) && (
              <div className="space-y-2 py-2">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="delete-scope"
                    className="mt-1"
                    checked={deleteScope === "SINGLE"}
                    onChange={() => setDeleteScope("SINGLE")}
                  />
                  <span>
                    <span className="font-medium">Hanya agenda ini</span>
                    <span className="block text-muted-foreground">
                      Kemunculan lain dari rangkaian tetap ada.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="delete-scope"
                    className="mt-1"
                    checked={deleteScope === "SERIES"}
                    onChange={() => setDeleteScope("SERIES")}
                  />
                  <span>
                    <span className="font-medium">Seluruh rangkaian</span>
                    <span className="block text-muted-foreground">
                      Semua kemunculan agenda berulang ini ikut dihapus.
                    </span>
                  </span>
                </label>
              </div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}
