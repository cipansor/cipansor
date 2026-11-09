"use client";

import { useState, useEffect } from "react";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferencesInput,
} from "@cipansor/shared";
import { MainLayout } from "@/components/layout";
import { PageHeader } from "@/components/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useWebPush } from "@/hooks/use-web-push";
import { useAuthStore } from "@/stores/auth";
import { getEffectiveRole } from "@/lib/rbac";
import {
  useEmailTransport,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/hooks/use-notification-preferences";
import {
  Bell,
  Mail,
  MessageSquare,
  Smartphone,
  Banknote,
  UserCheck,
  GraduationCap,
  BookOpen,
  Megaphone,
  Calendar,
  FileText,
  Moon,
  RefreshCw,
  Save,
} from "lucide-react";

// The shape the API stores and validates (`@cipansor/shared`). This page used
// to declare its own copy and "save" it into a 500 ms timer; nothing reached
// the server, and every toggle came back on at the next visit.
type NotificationPreferences = NotificationPreferencesInput;
const DEFAULT_PREFERENCES = DEFAULT_NOTIFICATION_PREFERENCES;

const CHANNEL_CONFIG = [
  {
    key: "emailEnabled",
    label: "Email",
    icon: Mail,
    description: "Terima notifikasi via email",
  },
  {
    key: "smsEnabled",
    label: "SMS",
    icon: Smartphone,
    description: "Terima notifikasi via SMS",
  },
  {
    key: "whatsappEnabled",
    label: "WhatsApp",
    icon: MessageSquare,
    description: "Terima notifikasi via WhatsApp",
  },
  {
    key: "pushEnabled",
    label: "Push",
    icon: Bell,
    description: "Ke ponsel atau peramban yang Anda aktifkan di bawah",
  },
];

const NOTIFICATION_TYPES = [
  {
    key: "paymentReminders",
    label: "Pengingat Pembayaran",
    icon: Banknote,
    description: "Tagihan dan jatuh tempo",
  },
  {
    key: "attendanceAlerts",
    label: "Alert Kehadiran",
    icon: UserCheck,
    description: "Status kehadiran santri",
  },
  {
    key: "academicUpdates",
    label: "Update Akademik",
    icon: GraduationCap,
    description: "Nilai dan progress pembelajaran",
  },
  {
    key: "tahfidzProgress",
    label: "Progress Tahfidz",
    icon: BookOpen,
    description: "Perkembangan hafalan Al-Quran",
  },
  {
    key: "announcements",
    label: "Pengumuman",
    icon: Megaphone,
    description: "Pengumuman dari sekolah",
  },
  {
    key: "eventReminders",
    label: "Pengingat Kegiatan",
    icon: Calendar,
    description: "Kegiatan dan acara mendatang",
  },
  {
    key: "monthlyReports",
    label: "Laporan Bulanan",
    icon: FileText,
    description: "Ringkasan bulanan santri",
  },
];

export default function NotificationSettingsPage() {
  const [preferences, setPreferences] =
    useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [hasChanges, setHasChanges] = useState(false);
  const webPush = useWebPush();

  // The outgoing-mail card is for the people who configure it. The endpoint is
  // admin-only, and since this page is linked for every role, asking it as a
  // wali or a teacher put an "Insufficient permissions" toast on their screen.
  const { user } = useAuthStore();
  const isAdmin = ["SUPER_ADMIN", "UNIT_ADMIN"].includes(
    getEffectiveRole(user) || "",
  );

  // What the server is actually configured to send with.
  const { data: transport, isLoading: transportLoading } =
    useEmailTransport(isAdmin);

  // What the server has stored for this person (defaults until first saved).
  const { isLoading, data: fetchedPreferences } = useNotificationPreferences();

  useEffect(() => {
    if (fetchedPreferences) {
      // The DTO also carries `userId`; the form holds only the preferences.
      const { userId: _userId, ...stored } = fetchedPreferences;
      setPreferences(stored);
      setHasChanges(false);
    }
  }, [fetchedPreferences]);

  const saveMutation = useUpdateNotificationPreferences();

  const handleToggle = (key: keyof NotificationPreferences) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: !prev[key as keyof typeof prev],
    }));
    setHasChanges(true);
  };

  const handleFrequencyChange = (value: string) => {
    setPreferences((prev) => ({
      ...prev,
      reminderFrequency: value as "DAILY" | "WEEKLY" | "NONE",
    }));
    setHasChanges(true);
  };

  const quietHoursOn = preferences.quietHoursStart !== null;

  const handleQuietHoursToggle = (on: boolean) => {
    setPreferences((prev) => ({
      ...prev,
      quietHoursStart: on ? "21:00" : null,
      quietHoursEnd: on ? "05:00" : null,
    }));
    setHasChanges(true);
  };

  const handleQuietHoursChange = (
    key: "quietHoursStart" | "quietHoursEnd",
    value: string,
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleReset = () => {
    setPreferences(DEFAULT_PREFERENCES);
    setHasChanges(true);
  };

  const handleSave = () => {
    saveMutation.mutate(preferences, {
      onSuccess: () => {
        toast.success("Pengaturan notifikasi berhasil disimpan");
        setHasChanges(false);
      },
      // The API's reason (e.g. quiet hours that start and end at the same
      // minute) is the useful part; the global handler toasts it.
    });
  };

  const enabledChannelCount = CHANNEL_CONFIG.filter(
    (c) => preferences[c.key as keyof NotificationPreferences],
  ).length;

  const enabledTypeCount = NOTIFICATION_TYPES.filter(
    (t) => preferences[t.key as keyof NotificationPreferences],
  ).length;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* The shared header stacks on a phone; the hand-built row it
            replaces pushed "Simpan" past the right edge at 390 px. */}
        <PageHeader
          title="Pengaturan Notifikasi"
          description="Kelola preferensi notifikasi Anda"
          backHref="/notifications/me"
          backLabel="Notifikasi Saya"
          actions={
            <>
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={isLoading}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Kembalikan Bawaan
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saveMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </>
          }
        />

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Saluran Aktif
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {enabledChannelCount} / {CHANNEL_CONFIG.length}
              </div>
              <p className="text-xs text-muted-foreground">
                metode pengiriman diaktifkan
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Jenis Notifikasi
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {enabledTypeCount} / {NOTIFICATION_TYPES.length}
              </div>
              <p className="text-xs text-muted-foreground">
                jenis notifikasi diaktifkan
              </p>
            </CardContent>
          </Card>
        </div>

        {/*
          What is actually configured on the server — asked, not asserted.

          This card used to print "noreply@cipansor.or.id", "halo@cipansor.or.id"
          and "smtp.gmail.com:587" as literal strings, and showed "Channel Email
          Aktif" whenever the channel toggle was on. With no transport configured
          — which is how production has run all along — it described a working
          Gmail setup while every message was being written to a log and thrown
          away. The badge now reports the transport, not the toggle.
        */}
        {isAdmin && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <Mail className="h-5 w-5" />
                Server Email Keluar
              </CardTitle>
              <CardDescription>
                Konfigurasi pengiriman email resmi Yayasan Pesantren Cipansor,
                dibaca langsung dari server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {transportLoading ? (
                <p className="text-sm text-muted-foreground">
                  Memuat konfigurasi…
                </p>
              ) : !transport ? (
                <p className="text-sm text-muted-foreground">
                  Konfigurasi email tidak dapat dibaca.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div className="rounded-md border bg-background p-3">
                      <span className="text-xs text-muted-foreground block">
                        Pengirim (From)
                      </span>
                      <strong className="font-medium text-foreground break-all">
                        {transport.from}
                      </strong>
                      <span className="text-xs text-muted-foreground block mt-1">
                        Alamat otomatis sistem — tidak dibaca manusia
                      </span>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <span className="text-xs text-muted-foreground block">
                        Tujuan balasan (Reply-To)
                      </span>
                      <strong className="font-medium text-foreground break-all">
                        {transport.replyTo}
                      </strong>
                      <span className="text-xs text-muted-foreground block mt-1">
                        Ke sinilah balasan wali santri sampai
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                    <span>
                      {transport.kind === "gmail_api" && (
                        <>
                          Metode: <code>Gmail API</code> (service account, tanpa
                          sandi aplikasi) sebagai{" "}
                          <code>{transport.sender}</code>
                        </>
                      )}
                      {transport.kind === "smtp" && (
                        <>
                          Metode: <code>SMTP</code> —{" "}
                          <code>{transport.host}</code>
                        </>
                      )}
                      {transport.kind === "log" && (
                        <>Belum ada transport email yang dikonfigurasi.</>
                      )}
                    </span>
                    {transport.configured ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500 bg-emerald-50 text-emerald-700"
                      >
                        Email siap kirim
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-500 bg-amber-50 text-amber-700"
                      >
                        Email tidak terkirim — hanya dicatat di log
                      </Badge>
                    )}
                  </div>

                  {!transport.configured && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      Notifikasi email tidak akan sampai ke siapa pun sampai
                      kredensial Gmail API atau SMTP diisi di server. Lihat{" "}
                      <code>docs/EMAIL_SETUP.md</code>.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Channel Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Saluran Notifikasi
            </CardTitle>
            <CardDescription>
              Pilih metode pengiriman notifikasi yang Anda inginkan
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {CHANNEL_CONFIG.map((channel) => {
              const Icon = channel.icon;
              const isEnabled =
                preferences[channel.key as keyof NotificationPreferences];

              return (
                <div
                  key={channel.key}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${isEnabled ? "bg-primary/10" : "bg-muted"}`}
                    >
                      <Icon
                        className={`h-5 w-5 ${isEnabled ? "text-primary" : "text-muted-foreground"}`}
                      />
                    </div>
                    <div>
                      <Label className="font-medium">{channel.label}</Label>
                      <p className="text-sm text-muted-foreground">
                        {channel.description}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={isEnabled as boolean}
                    disabled={isLoading}
                    onCheckedChange={() =>
                      handleToggle(channel.key as keyof NotificationPreferences)
                    }
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Web Push (browser) — a per-device control, separate from the
            per-user "Push" channel above. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifikasi Push di Perangkat Ini
            </CardTitle>
            <CardDescription>
              Terima notifikasi di ponsel atau peramban ini walau portal sedang
              tertutup. Setiap perangkat diaktifkan sendiri-sendiri. Untuk
              kesehatan, konseling, pelanggaran, dan aduan, layar kunci hanya
              menampilkan &ldquo;Ada pemberitahuan baru&rdquo;; isinya dibaca
              setelah membuka portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {webPush.state === "checking" && "Memeriksa…"}
              {webPush.state === "unsupported" &&
                "Browser ini tidak mendukung notifikasi push."}
              {webPush.state === "needs-install" &&
                "Di iPhone/iPad, pasang dulu portal ini ke Layar Utama (Bagikan → Tambah ke Layar Utama) untuk mengaktifkan notifikasi push."}
              {webPush.state === "unconfigured" &&
                "Notifikasi push belum tersedia di server ini."}
              {webPush.state === "denied" &&
                "Izin notifikasi diblokir. Buka pengaturan situs di browser untuk mengizinkan."}
              {webPush.state === "subscribed" &&
                (preferences.pushEnabled
                  ? "Aktif. Perangkat ini menerima notifikasi push."
                  : "Perangkat ini terdaftar, tetapi saluran Push di atas dimatikan, jadi tidak ada yang dikirim.")}
              {webPush.state === "unsubscribed" &&
                "Belum aktif di perangkat ini."}
            </p>
            {webPush.state === "subscribed" ? (
              <Button
                variant="outline"
                onClick={webPush.disable}
                disabled={webPush.busy}
              >
                Matikan
              </Button>
            ) : (
              <Button
                onClick={webPush.enable}
                disabled={
                  webPush.busy ||
                  webPush.state === "checking" ||
                  webPush.state === "unsupported" ||
                  webPush.state === "needs-install" ||
                  webPush.state === "unconfigured" ||
                  webPush.state === "denied"
                }
              >
                Aktifkan di perangkat ini
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Notification Type Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Jenis Notifikasi
            </CardTitle>
            <CardDescription>
              Pilih jenis notifikasi yang ingin Anda terima
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {NOTIFICATION_TYPES.map((type) => {
              const Icon = type.icon;
              const isEnabled =
                preferences[type.key as keyof NotificationPreferences];

              return (
                <div
                  key={type.key}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${isEnabled ? "bg-primary/10" : "bg-muted"}`}
                    >
                      <Icon
                        className={`h-5 w-5 ${isEnabled ? "text-primary" : "text-muted-foreground"}`}
                      />
                    </div>
                    <div>
                      <Label className="font-medium">{type.label}</Label>
                      <p className="text-sm text-muted-foreground">
                        {type.description}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={isEnabled as boolean}
                    disabled={isLoading}
                    onCheckedChange={() =>
                      handleToggle(type.key as keyof NotificationPreferences)
                    }
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Frequency & Timing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Moon className="h-5 w-5" />
              Frekuensi & Waktu
            </CardTitle>
            <CardDescription>
              Atur frekuensi pengingat dan jam tenang
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Frekuensi Pengingat</Label>
                <p className="text-sm text-muted-foreground">
                  Seberapa sering menerima ringkasan
                </p>
              </div>
              <Select
                value={preferences.reminderFrequency}
                onValueChange={handleFrequencyChange}
                disabled={isLoading}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Harian</SelectItem>
                  <SelectItem value="WEEKLY">Mingguan</SelectItem>
                  <SelectItem value="NONE">Tidak Ada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="quiet-hours" className="font-medium">
                  Jam Tenang
                </Label>
                <p className="text-sm text-muted-foreground">
                  Selama jam ini notifikasi push tidak dikirim. Notifikasinya
                  tetap ada di lonceng.
                </p>
              </div>
              <Switch
                id="quiet-hours"
                checked={quietHoursOn}
                disabled={isLoading}
                onCheckedChange={handleQuietHoursToggle}
              />
            </div>
            {quietHoursOn && (
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label htmlFor="quiet-start">Mulai (WIB)</Label>
                  <Input
                    id="quiet-start"
                    type="time"
                    className="w-32"
                    value={preferences.quietHoursStart ?? ""}
                    onChange={(e) =>
                      handleQuietHoursChange("quietHoursStart", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="quiet-end">Selesai (WIB)</Label>
                  <Input
                    id="quiet-end"
                    type="time"
                    className="w-32"
                    value={preferences.quietHoursEnd ?? ""}
                    onChange={(e) =>
                      handleQuietHoursChange("quietHoursEnd", e.target.value)
                    }
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unsaved Changes Banner */}
        {hasChanges && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
            <Badge variant="secondary" className="px-4 py-2 shadow-lg">
              Ada perubahan yang belum disimpan
            </Badge>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
