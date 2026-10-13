"use client";

import { useState } from "react";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  Send,
  CreditCard,
  AlertTriangle,
  Calendar,
  BookOpen,
  FileCheck,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Smartphone,
  Settings,
  Play,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useUnits } from "@/hooks";
import { api } from "@/lib/api";

// Template types for WhatsApp
const WA_TEMPLATES = [
  {
    id: "payment_reminder",
    name: "Pengingat Pembayaran",
    description: "Notifikasi pengingat pembayaran SPP/tagihan",
    icon: CreditCard,
    category: "finance",
    variables: ["parentName", "studentName", "amount", "dueDate"],
    preview: `Assalamu\'alaikum Bapak/Ibu *{parentName}*,

Ini adalah pengingat pembayaran untuk:
📚 *Nama Santri:* {studentName}
💰 *Jumlah:* {amount}
📅 *Jatuh Tempo:* {dueDate}

Mohon segera melakukan pembayaran.

_Pesantren Cipansor_`,
  },
  {
    id: "violation_alert",
    name: "Laporan Pelanggaran",
    description: "Notifikasi pelanggaran siswa ke orang tua",
    icon: AlertTriangle,
    category: "discipline",
    variables: ["parentName", "studentName", "type", "description", "date"],
    preview: `Assalamu\'alaikum Bapak/Ibu *{parentName}*,

📋 *LAPORAN PELANGGARAN*

👤 *Nama:* {studentName}
📅 *Tanggal:* {date}
⚠️ *Jenis:* {type}
📝 *Keterangan:* {description}

Mohon kerja sama untuk pembinaan.

_Tim Pembinaan Pesantren Cipansor_`,
  },
  {
    id: "absence_alert",
    name: "Laporan Ketidakhadiran",
    description: "Notifikasi siswa alpha/tidak hadir",
    icon: Calendar,
    category: "attendance",
    variables: ["parentName", "studentName", "date"],
    preview: `Assalamu\'alaikum Bapak/Ibu *{parentName}*,

📅 *Hari ini ({date})*

*{studentName}* tidak hadir tanpa keterangan (Alpha).

Mohon konfirmasi kondisi putra/putri.

_Pesantren Cipansor_`,
  },
  {
    id: "tahfidz_progress",
    name: "Progress Tahfidz",
    description: "Laporan perkembangan hafalan Al-Quran",
    icon: BookOpen,
    category: "academic",
    variables: [
      "parentName",
      "studentName",
      "surah",
      "ayahStart",
      "ayahEnd",
      "juz",
    ],
    preview: `Assalamu\'alaikum Bapak/Ibu *{parentName}*,

🕌 *LAPORAN TAHFIDZ*

👤 *Santri:* {studentName}
📖 *Surah:* {surah}
📜 *Ayat:* {ayahStart} - {ayahEnd}
📚 *Juz:* {juz}

Barakallahu fiikum.

_Tim Tahfidz Pesantren Cipansor_`,
  },
  {
    id: "permit_status",
    name: "Status Izin",
    description: "Update status pengajuan izin",
    icon: FileCheck,
    category: "permit",
    variables: [
      "parentName",
      "studentName",
      "permitType",
      "status",
      "startDate",
      "endDate",
    ],
    preview: `Assalamu\'alaikum Bapak/Ibu *{parentName}*,

📋 *UPDATE STATUS IZIN*

👤 *Santri:* {studentName}
📝 *Jenis:* {permitType}
📅 *Tanggal:* {startDate} - {endDate}
✅ *Status:* *{status}*

_Pesantren Cipansor_`,
  },
];

// Scheduled tasks
// Task ids and schedules must match `registerDefaultTasks()` in
// apps/api/src/modules/notifications/scheduler.service.ts — the trigger
// endpoint validates the id, so a mismatch is rejected as an unknown task.
const SCHEDULED_TASKS = [
  {
    id: "payment-reminder",
    name: "Pengingat Pembayaran Harian",
    description: "Mengirim pengingat pembayaran H-7, H-3, H-1",
    schedule: "08:00 setiap hari",
    enabled: true,
  },
  {
    id: "event-reminder",
    name: "Pengingat Kegiatan",
    description: "Mengirim pengingat kegiatan H-1",
    schedule: "07:00 setiap hari",
    enabled: true,
  },
  {
    id: "attendance-summary",
    name: "Ringkasan Kehadiran Harian",
    description: "Mengirim ringkasan kehadiran siswa alpha kepada orang tua",
    schedule: "18:00 setiap hari",
    enabled: true,
  },
  {
    id: "tahfidz-progress",
    name: "Laporan Tahfidz Mingguan",
    description: "Mengirim laporan progress hafalan mingguan",
    schedule: "16:00 setiap Jumat",
    enabled: true,
  },
  {
    id: "monthly-report",
    name: "Laporan Bulanan",
    description: "Mengirim laporan progress bulanan ke orang tua",
    schedule: "09:00 tanggal 1 setiap bulan",
    enabled: true,
  },
  {
    id: "budget-overrun-alert",
    name: "Peringatan Anggaran Berlebih",
    description: "Mengirim peringatan realisasi anggaran RKA di atas 120%",
    schedule: "07:00 setiap Senin",
    enabled: true,
  },
];

export default function WhatsAppPage() {
  // Broadcasting is Pengumuman's alone (decisions/siaran-pengumuman.md).
  const [activeTab, setActiveTab] = useState("single");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [singleSend, setSingleSend] = useState({
    phone: "",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [providerStatus, setProviderStatus] = useState<{
    provider: string;
    configured: boolean;
  } | null>(null);

  const { data: units } = useUnits();

  // Check WhatsApp status
  const checkStatus = async () => {
    try {
      const { data } = await api.get("/notifications/whatsapp/status");
      if (data.success) {
        setProviderStatus(data.data);
      }
    } catch {
      toast.error("Gagal memeriksa status WhatsApp");
    }
  };

  // Send single message
  const handleSingleSend = async () => {
    if (!singleSend.phone || !singleSend.message) {
      toast.error("Nomor telepon dan pesan harus diisi");
      return;
    }

    setIsLoading(true);
    try {
      const { data } = await api.post(
        "/notifications/whatsapp/send",
        singleSend,
      );

      if (data.success) {
        toast.success("Pesan berhasil dikirim");
        setSingleSend({ phone: "", message: "" });
      } else {
        toast.error(data.data?.error || "Gagal mengirim pesan");
      }
    } catch {
      toast.error("Gagal mengirim pesan");
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger scheduled task
  const handleTriggerTask = async (taskId: string) => {
    setIsLoading(true);
    try {
      const { data } = await api.post("/notifications/scheduler/trigger", {
        task: taskId,
      });

      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error("Gagal menjalankan tugas");
      }
    } catch {
      toast.error("Gagal menjalankan tugas");
    } finally {
      setIsLoading(false);
    }
  };

  const selectedTemplateData = WA_TEMPLATES.find(
    (t) => t.id === selectedTemplate,
  );

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <MessageSquare className="h-8 w-8 text-green-500" />
              WhatsApp Notification
            </h1>
            <p className="text-muted-foreground">
              Kirim notifikasi via WhatsApp kepada orang tua dan guru
            </p>
          </div>
          <Button variant="outline" onClick={checkStatus}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Cek Status
          </Button>
        </div>

        {/* Provider Status */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                  <Smartphone className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="font-medium">Status Provider</p>
                  <p className="text-sm text-muted-foreground">
                    {providerStatus?.provider || "Belum dicek"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {providerStatus?.configured ? (
                  <Badge className="bg-green-100 text-green-800">
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Terhubung
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="mr-1 h-3 w-3" />
                    Tidak Terhubung
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="single">
              <Send className="mr-2 h-4 w-4" />
              Kirim Pesan
            </TabsTrigger>
            <TabsTrigger value="templates">
              <MessageSquare className="mr-2 h-4 w-4" />
              Template
            </TabsTrigger>
            <TabsTrigger value="scheduler">
              <Clock className="mr-2 h-4 w-4" />
              Penjadwalan
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="mr-2 h-4 w-4" />
              Pengaturan
            </TabsTrigger>
          </TabsList>

          {/* Single Send Tab */}
          <TabsContent value="single" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Kirim Pesan Individual</CardTitle>
                <CardDescription>
                  Kirim pesan WhatsApp ke nomor tertentu
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="single-phone">Nomor Telepon</Label>
                  <Input
                    id="single-phone"
                    placeholder="08xxxxxxxxxx atau 628xxxxxxxxx"
                    value={singleSend.phone}
                    onChange={(e) =>
                      setSingleSend({ ...singleSend, phone: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Format: 08xx atau 628xx (tanpa +)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="single-message">Pesan</Label>
                  <Textarea
                    id="single-message"
                    placeholder="Ketik pesan..."
                    rows={5}
                    value={singleSend.message}
                    onChange={(e) =>
                      setSingleSend({ ...singleSend, message: e.target.value })
                    }
                  />
                </div>
                <Button onClick={handleSingleSend} disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Kirim Pesan
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Templates Tab */}
          <TabsContent value="templates" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {WA_TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <Card
                    key={template.id}
                    className={`cursor-pointer transition-all ${
                      selectedTemplate === template.id
                        ? "ring-2 ring-green-500"
                        : "hover:shadow-md"
                    }`}
                    onClick={() => setSelectedTemplate(template.id)}
                  >
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                          <Icon className="h-5 w-5 text-green-600" />
                        </div>
                        <div className="flex-1">
                          <CardTitle className="text-base">
                            {template.name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {template.description}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Variabel:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {template.variables.map((v) => (
                            <Badge
                              key={v}
                              variant="secondary"
                              className="text-xs"
                            >
                              {`{${v}}`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {selectedTemplateData && (
              <Card>
                <CardHeader>
                  <CardTitle>Preview: {selectedTemplateData.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-green-50 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap">
                    {selectedTemplateData.preview}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Scheduler Tab */}
          <TabsContent value="scheduler" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Tugas Terjadwal</CardTitle>
                <CardDescription>
                  Notifikasi otomatis yang berjalan sesuai jadwal
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {SCHEDULED_TASKS.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`h-10 w-10 rounded-full flex items-center justify-center ${
                            task.enabled ? "bg-green-100" : "bg-gray-100"
                          }`}
                        >
                          <Clock
                            className={`h-5 w-5 ${
                              task.enabled ? "text-green-600" : "text-gray-400"
                            }`}
                          />
                        </div>
                        <div>
                          <p className="font-medium">{task.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {task.description}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Jadwal: {task.schedule}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Switch checked={task.enabled} />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTriggerTask(task.id)}
                          disabled={isLoading}
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Jalankan
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Konfigurasi Provider</CardTitle>
                <CardDescription>
                  Pengaturan provider WhatsApp Business API
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Provider Aktif</Label>
                  <Select defaultValue="FONNTE">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="META">
                        Meta WhatsApp Cloud API
                      </SelectItem>
                      <SelectItem value="FONNTE">Fonnte (Indonesia)</SelectItem>
                      <SelectItem value="WATROOP">WATroop</SelectItem>
                      <SelectItem value="WHACENTER">Whacenter</SelectItem>
                      <SelectItem value="SIMULATOR">Simulator (Dev)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h4 className="font-medium">Konfigurasi Fonnte</h4>
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <Input type="password" placeholder="Masukkan API Key" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Dapatkan API Key dari{" "}
                    <a
                      href="https://fonnte.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-600 underline"
                    >
                      fonnte.com
                    </a>
                  </p>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h4 className="font-medium">Konfigurasi Meta Cloud API</h4>
                  <div className="space-y-2">
                    <Label>Phone Number ID</Label>
                    <Input placeholder="Masukkan Phone Number ID" />
                  </div>
                  <div className="space-y-2">
                    <Label>Access Token</Label>
                    <Input
                      type="password"
                      placeholder="Masukkan Access Token"
                    />
                  </div>
                </div>

                <Button>Simpan Pengaturan</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
