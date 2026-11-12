"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { ParentChild, ParentDashboardData } from "@cipansor/shared";
import Link from "next/link";
import {
  Users,
  GraduationCap,
  Calendar,
  AlertTriangle,
  Receipt,
  BookOpen,
  Bell,
  MessageSquare,
  Star,
  HeartHandshake,
} from "lucide-react";

/**
 * The share of the last seven attendance rows the child was `PRESENT` for, as a
 * whole percent (decision K13, issue #869); `null` when there are no rows, so
 * "no records" never reads as "never came" (0%).
 */
function attendancePercentage(
  recentAttendance: ParentDashboardData["children"][number]["recentAttendance"],
): number | null {
  if (recentAttendance.length === 0) return null;
  const present = recentAttendance.filter((a) => a.status === "PRESENT").length;
  return Math.round((present / recentAttendance.length) * 100);
}

export default function ParentDashboardPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<ParentChild[]>([]);
  const [dashboard, setDashboard] = useState<ParentDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Fetch children list and dashboard summary
        const [childrenRes, dashboardRes] = await Promise.all([
          api.get("/parent/children"),
          api.get("/parent/dashboard"),
        ]);
        setChildren(childrenRes.data.data || []);
        setDashboard(dashboardRes.data.data || null);
      } catch (err: any) {
        console.error("Failed to fetch parent data:", err);
        setError(err.response?.data?.error?.message || "Gagal memuat data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-destructive">{error}</p>
          <Button onClick={() => window.location.reload()} className="mt-4">
            Coba Lagi
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Selamat Datang, {user?.name?.split(" ")[0]}!
          </h1>
          <p className="text-muted-foreground">
            Portal Orang Tua - Pantau perkembangan anak Anda
          </p>
        </div>
        {dashboard && dashboard.unreadNotifications > 0 && (
          <Link href="/announcements">
            <Button variant="outline" className="gap-2">
              <Bell className="h-4 w-4" />
              {dashboard.unreadNotifications} Notifikasi Baru
            </Button>
          </Link>
        )}
      </div>

      {/* Children Cards */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {children.map((child) => {
          const summary = dashboard?.children.find(
            (c) => c.child.id === child.id,
          );
          const attendance = summary
            ? attendancePercentage(summary.recentAttendance)
            : null;

          return (
            <Card key={child.id} className="overflow-hidden">
              <CardHeader className="bg-primary/5 pb-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-2xl">
                    {child.name.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">{child.name}</CardTitle>
                    <CardDescription>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <Badge variant="secondary">{child.nis}</Badge>
                        {child.currentClass && (
                          <Badge variant="outline">
                            {child.currentClass.name}
                          </Badge>
                        )}
                      </div>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {/* Attendance — computed from the last seven rows, not a field. */}
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Kehadiran:{" "}
                      {attendance === null ? (
                        <strong className="text-muted-foreground">—</strong>
                      ) : (
                        <strong
                          className={
                            attendance >= 80 ? "text-green-600" : "text-red-600"
                          }
                        >
                          {attendance}%
                        </strong>
                      )}
                    </span>
                  </div>

                  {/* Tahfidz */}
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Tahfidz:{" "}
                      <strong>{summary?.lastTahfidz?.juz ?? 0} Juz</strong>
                    </span>
                  </div>
                </div>

                {/* Analytics. Skor Holistik applies to every santri, so its tile
                    stays and shows "–" while no query produced a figure (K13.2);
                    Kerukunan Asrama is only meaningful for a santri who lives in
                    an asrama, so its tile appears only when a placement exists. */}
                {summary && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100 flex flex-col items-center justify-center">
                      <p className="text-[10px] text-indigo-700 font-bold uppercase">
                        Skor Holistik
                      </p>
                      <p className="text-lg font-black text-indigo-900">
                        {summary.holisticScore ?? "—"}
                      </p>
                    </div>
                    {summary.boardingHarmonyScore != null && (
                      <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-100 flex flex-col items-center justify-center">
                        <p className="text-[10px] text-emerald-700 font-bold uppercase">
                          Kerukunan Asrama
                        </p>
                        <p className="text-lg font-black text-emerald-900">
                          {summary.boardingHarmonyScore}%
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Pending Payments */}
                {(summary?.pendingInvoices ?? 0) > 0 && (
                  <div className="mt-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                    <div className="flex items-center gap-2 text-yellow-700">
                      <Receipt className="h-4 w-4" />
                      <span className="font-medium">
                        {summary?.pendingInvoices} tagihan belum lunas
                      </span>
                    </div>
                  </div>
                )}

                {/* View Details Button */}
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/parent/children?id=${child.id}`}
                    className="flex-1"
                  >
                    <Button variant="outline" className="w-full">
                      Lihat Detail
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* No children message */}
        {children.length === 0 && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="p-8 text-center">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">Belum ada data anak</h3>
              <p className="text-muted-foreground mt-2">
                Silakan hubungi admin sekolah untuk menghubungkan akun Anda
                dengan data anak.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Announcements */}
      {dashboard?.recentAnnouncements &&
        dashboard.recentAnnouncements.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Pengumuman Terbaru
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {dashboard.recentAnnouncements
                  .slice(0, 3)
                  .map((announcement) => (
                    <div
                      key={announcement.id}
                      className="flex items-start gap-4 p-4 rounded-lg border"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{announcement.title}</h4>
                          {announcement.priority >= 1 && (
                            <Badge variant="destructive">Penting</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {announcement.content}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(announcement.createdAt).toLocaleDateString(
                            "id-ID",
                            {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            },
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
              <Link href="/announcements">
                <Button variant="link" className="mt-4 p-0">
                  Lihat Semua Pengumuman →
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Aksi Cepat</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/parent/children">
              <Button variant="outline" className="w-full h-20 flex-col gap-2">
                <Users className="h-6 w-6" />
                <span>Data Anak</span>
              </Button>
            </Link>
            <Link href="/parent/finance">
              <Button variant="outline" className="w-full h-20 flex-col gap-2">
                <Receipt className="h-6 w-6" />
                <span>Keuangan</span>
              </Button>
            </Link>
            <Link href="/parent/permits">
              <Button variant="outline" className="w-full h-20 flex-col gap-2">
                <GraduationCap className="h-6 w-6" />
                <span>Ajukan Izin</span>
              </Button>
            </Link>
            <Link href="/announcements">
              <Button variant="outline" className="w-full h-20 flex-col gap-2">
                <Bell className="h-6 w-6" />
                <span>Pengumuman</span>
              </Button>
            </Link>
            <Link href="/parent/messages">
              <Button variant="outline" className="w-full h-20 flex-col gap-2">
                <MessageSquare className="h-6 w-6" />
                <span>Pesan Guru</span>
              </Button>
            </Link>
            <Link href="/parent/ibadah">
              <Button variant="outline" className="w-full h-20 flex-col gap-2">
                <Star className="h-6 w-6" />
                <span>Mutaba&apos;ah</span>
              </Button>
            </Link>
            <Link href="/parent/counseling">
              <Button variant="outline" className="w-full h-20 flex-col gap-2">
                <HeartHandshake className="h-6 w-6" />
                <span>Konseling</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
