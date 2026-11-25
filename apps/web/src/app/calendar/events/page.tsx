"use client";
import { useState } from "react";
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
} from "@/hooks/use-calendar";
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
import { useCanWriteCalendar } from "@/hooks/use-calendar-permissions";
import { toast } from "sonner";

export default function EventsListPage() {
  const canWrite = useCanWriteCalendar();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | "">("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: eventsData, isLoading } = useCalendarEvents({
    limit: 50,
    eventType: categoryFilter || undefined,
    manage: true,
  });
  const events = eventsData?.data || [];

  const deleteEvent = useDeleteCalendarEvent();

  // Filter events by search
  const filteredEvents = events.filter(
    (event) =>
      event.title.toLowerCase().includes(search.toLowerCase()) ||
      event.description?.toLowerCase().includes(search.toLowerCase()) ||
      event.location?.toLowerCase().includes(search.toLowerCase()),
  );

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteEvent.mutateAsync(deleteId);
      toast.success("Event berhasil dihapus");
      setDeleteId(null);
    } catch {
      toast.error("Gagal menghapus event");
    }
  };

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
            {canWrite && (
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
                  placeholder="Cari event..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={categoryFilter}
                onValueChange={(v) =>
                  setCategoryFilter(v as EventCategory | "")
                }
              >
                <SelectTrigger className="w-48">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Semua Kategori</SelectItem>
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
            <CardDescription>
              {filteredEvents.length} event ditemukan
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Tidak ada event ditemukan</p>
                {canWrite && (
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
                  {filteredEvents.map((event) => {
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
                              event.startDate !== event.endDate && (
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
                              {canWrite && (
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
                                    onClick={() => setDeleteId(event.id)}
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

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus Event?</AlertDialogTitle>
              <AlertDialogDescription>
                Event yang dihapus tidak dapat dikembalikan. Apakah Anda yakin
                ingin melanjutkan?
              </AlertDialogDescription>
            </AlertDialogHeader>
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
