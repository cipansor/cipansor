"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowLeft,
  MessageSquare,
  Calendar,
  User,
  Languages,
  FileText,
  Save,
  Search,
  Users,
  Shuffle,
} from "lucide-react";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import { useStudents, useStudent } from "@/hooks/use-students";
import { useUnits } from "@/hooks/use-units";
import { useCreateMuhadatsah, useMatchPartners } from "@/hooks/use-muhadatsah";
import { STUDENT_STATUS } from "@cipansor/shared";

// Form Schema
const muhadatsahSchema = z.object({
  studentId: z.string().min(1, "Santri harus dipilih"),
  partnerId: z.string().optional(),
  unitId: z.string().min(1, "Unit harus dipilih"),
  scheduledAt: z.date({
    error: "Tanggal dan waktu harus diisi",
  }),
  topic: z.string().max(200).optional(),
  language: z.enum(["Arabic", "English"], {
    error: "Bahasa harus dipilih",
  }),
});

type MuhadatsahFormData = z.infer<typeof muhadatsahSchema>;

// Language options
const LANGUAGE_OPTIONS = [
  {
    value: "Arabic",
    label: "Bahasa Arab",
    flag: "🕌",
    description: "Al-Lughah Al-Arabiyyah",
  },
  {
    value: "English",
    label: "Bahasa Inggris",
    flag: "🇬🇧",
    description: "English Conversation",
  },
];

// Sample topics
const TOPIC_SUGGESTIONS = {
  Arabic: [
    "في السوق - Di Pasar",
    "في المدرسة - Di Sekolah",
    "في المسجد - Di Masjid",
    "في البيت - Di Rumah",
    "عند الطبيب - Di Dokter",
    "في المطعم - Di Restoran",
    "السفر والرحلة - Perjalanan",
    "الطعام والشراب - Makanan & Minuman",
  ],
  English: [
    "At the Market",
    "At School",
    "At the Library",
    "Daily Routine",
    "My Family",
    "Hobbies and Interests",
    "Future Plans",
    "Health and Fitness",
  ],
};

export default function NewMuhadatsahPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // "Cari Partner" hands the chosen santri over as the partner for this session.
  const presetPartnerId = searchParams.get("partnerId") ?? undefined;
  const [studentSearch, setStudentSearch] = useState("");
  const [studentOpen, setStudentOpen] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState("08:00");

  // Form
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<MuhadatsahFormData>({
    resolver: zodResolver(muhadatsahSchema),
    defaultValues: {
      language: "Arabic",
    },
  });

  const selectedUnitId = watch("unitId");
  const selectedLanguage = watch("language");
  const selectedDate = watch("scheduledAt");
  const selectedStudentId = watch("studentId");
  const selectedPartnerId = watch("partnerId");

  // Data fetching
  const { data: unitsData } = useUnits();
  const units = unitsData || [];

  const { data: studentsData, isLoading: studentsLoading } = useStudents({
    unitId: selectedUnitId,
    search: studentSearch,
    limit: 50,
    status: STUDENT_STATUS.ACTIVE,
  });
  const students = studentsData?.data || [];

  const { data: partnersData } = useStudents({
    unitId: selectedUnitId,
    search: partnerSearch,
    limit: 50,
    status: STUDENT_STATUS.ACTIVE,
  });
  // Filter out selected student from partners
  const availablePartners = (partnersData?.data || []).filter(
    (s) => s.id !== selectedStudentId,
  );

  const createMuhadatsah = useCreateMuhadatsah();

  // The preset partner's unit is not part of the match-partners payload, so the
  // santri is read once to fill both the unit (which loads the roster) and the
  // partner field; otherwise picking a unit would clear the preselection.
  const { data: presetPartner } = useStudent(presetPartnerId);
  useEffect(() => {
    if (!presetPartner) return;
    setValue("unitId", presetPartner.unitId);
    setValue("partnerId", presetPartner.id);
  }, [presetPartner, setValue]);

  // Get selected student and partner info
  const selectedStudent = students.find((s) => s.id === selectedStudentId);
  const selectedPartner =
    availablePartners.find((s) => s.id === selectedPartnerId) ??
    (presetPartner?.id === selectedPartnerId ? presetPartner : undefined);

  // Random partner assignment
  const handleRandomPartner = () => {
    if (availablePartners.length === 0) {
      toast.error("Tidak ada partner yang tersedia");
      return;
    }
    const randomIndex = Math.floor(Math.random() * availablePartners.length);
    setValue("partnerId", availablePartners[randomIndex].id);
    toast.success("Partner dipilih secara acak");
  };

  // Handle form submit
  const onSubmit = async (data: MuhadatsahFormData) => {
    try {
      // Combine date and time
      const [hours, minutes] = selectedTime.split(":").map(Number);
      const scheduledAt = new Date(data.scheduledAt);
      scheduledAt.setHours(hours, minutes, 0, 0);

      await createMuhadatsah.mutateAsync({
        unitId: data.unitId,
        studentId: data.studentId,
        partnerId: data.partnerId || undefined,
        scheduledAt: scheduledAt.toISOString(),
        topic: data.topic || undefined,
        language: data.language,
      });

      toast.success("Jadwal muhadatsah berhasil dibuat");
      router.push("/muhadatsah");
    } catch (error) {
      toast.error("Gagal membuat jadwal muhadatsah");
    }
  };

  return (
    <MainLayout>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/muhadatsah">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Kembali
          </Link>
        </Button>
        <PageHeader
          title="Jadwalkan Muhadatsah"
          description="Buat jadwal latihan percakapan bahasa untuk santri"
        />
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid gap-6 md:grid-cols-3">
          {/* Main Form */}
          <div className="md:col-span-2 space-y-6">
            {/* Language Selection - First */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Languages className="h-5 w-5" />
                  Pilih Bahasa
                </CardTitle>
                <CardDescription>
                  Tentukan bahasa yang akan digunakan dalam sesi muhadatsah
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <Button
                      key={lang.value}
                      type="button"
                      variant={
                        selectedLanguage === lang.value ? "default" : "outline"
                      }
                      className="h-auto py-4 flex flex-col gap-2"
                      onClick={() =>
                        setValue("language", lang.value as "Arabic" | "English")
                      }
                    >
                      <span className="text-3xl">{lang.flag}</span>
                      <span className="font-medium">{lang.label}</span>
                      <span className="text-xs opacity-70">
                        {lang.description}
                      </span>
                    </Button>
                  ))}
                </div>
                {errors.language && (
                  <p className="text-sm text-destructive mt-2">
                    {errors.language.message}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Unit & Students Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />
                  Peserta Muhadatsah
                </CardTitle>
                <CardDescription>
                  Pilih santri dan partner untuk sesi percakapan
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Unit Selection */}
                <div className="space-y-2">
                  <Label htmlFor="unitId">Unit / Sekolah *</Label>
                  <Select
                    value={selectedUnitId}
                    onValueChange={(value) => {
                      setValue("unitId", value);
                      setValue("studentId", "");
                      setValue("partnerId", "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih unit..." />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          {unit.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.unitId && (
                    <p className="text-sm text-destructive">
                      {errors.unitId.message}
                    </p>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* Student Selection */}
                  <div className="space-y-2">
                    <Label htmlFor="studentId">Santri 1 *</Label>
                    <Popover open={studentOpen} onOpenChange={setStudentOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={studentOpen}
                          className="w-full justify-between"
                          disabled={!selectedUnitId}
                        >
                          {selectedStudent ? (
                            <span className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="text-xs">
                                  {selectedStudent.name
                                    ?.split(" ")
                                    .map((n) => n[0])
                                    .join("")
                                    .slice(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">
                                {selectedStudent.name}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {selectedUnitId
                                ? "Pilih santri..."
                                : "Pilih unit dulu"}
                            </span>
                          )}
                          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput
                            placeholder="Cari santri..."
                            value={studentSearch}
                            onValueChange={setStudentSearch}
                          />
                          <CommandList>
                            <CommandEmpty>
                              {studentsLoading
                                ? "Memuat..."
                                : "Tidak ditemukan"}
                            </CommandEmpty>
                            <CommandGroup>
                              {students.map((student) => (
                                <CommandItem
                                  key={student.id}
                                  value={`${student.name} ${student.nis}`}
                                  onSelect={() => {
                                    setValue("studentId", student.id);
                                    if (selectedPartnerId === student.id) {
                                      setValue("partnerId", "");
                                    }
                                    setStudentOpen(false);
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-8 w-8">
                                      <AvatarFallback className="text-xs">
                                        {student.name
                                          ?.split(" ")
                                          .map((n) => n[0])
                                          .join("")
                                          .slice(0, 2)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div>
                                      <p className="font-medium">
                                        {student.name}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {student.nis} •{" "}
                                        {student.currentClass?.name || "-"}
                                      </p>
                                    </div>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {errors.studentId && (
                      <p className="text-sm text-destructive">
                        {errors.studentId.message}
                      </p>
                    )}
                  </div>

                  {/* Partner Selection */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="partnerId">Santri 2 / Partner</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRandomPartner}
                        disabled={
                          !selectedStudentId || availablePartners.length === 0
                        }
                      >
                        <Shuffle className="h-3 w-3 mr-1" />
                        Acak
                      </Button>
                    </div>
                    <Popover open={partnerOpen} onOpenChange={setPartnerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={partnerOpen}
                          className="w-full justify-between"
                          disabled={!selectedStudentId}
                        >
                          {selectedPartner ? (
                            <span className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="text-xs">
                                  {selectedPartner.name
                                    ?.split(" ")
                                    .map((n) => n[0])
                                    .join("")
                                    .slice(0, 2)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">
                                {selectedPartner.name}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {selectedStudentId
                                ? "Pilih partner (opsional)..."
                                : "Pilih santri 1 dulu"}
                            </span>
                          )}
                          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput
                            placeholder="Cari partner..."
                            value={partnerSearch}
                            onValueChange={setPartnerSearch}
                          />
                          <CommandList>
                            <CommandEmpty>Tidak ditemukan</CommandEmpty>
                            <CommandGroup>
                              {availablePartners.map((partner) => (
                                <CommandItem
                                  key={partner.id}
                                  value={`${partner.name} ${partner.nis}`}
                                  onSelect={() => {
                                    setValue("partnerId", partner.id);
                                    setPartnerOpen(false);
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-8 w-8">
                                      <AvatarFallback className="text-xs">
                                        {partner.name
                                          ?.split(" ")
                                          .map((n) => n[0])
                                          .join("")
                                          .slice(0, 2)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div>
                                      <p className="font-medium">
                                        {partner.name}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {partner.nis} •{" "}
                                        {partner.currentClass?.name || "-"}
                                      </p>
                                    </div>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      Partner bisa ditentukan nanti atau dipilih secara acak
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Schedule */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Calendar className="h-5 w-5" />
                  Jadwal Pelaksanaan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Date */}
                  <div className="space-y-2">
                    <Label>Tanggal *</Label>
                    <Popover open={dateOpen} onOpenChange={setDateOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal"
                        >
                          <Calendar className="mr-2 h-4 w-4" />
                          {selectedDate ? (
                            format(selectedDate, "EEEE, dd MMMM yyyy", {
                              locale: localeId,
                            })
                          ) : (
                            <span className="text-muted-foreground">
                              Pilih tanggal
                            </span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={selectedDate}
                          onSelect={(date) => {
                            if (date) {
                              setValue("scheduledAt", date);
                              setDateOpen(false);
                            }
                          }}
                          disabled={(date) =>
                            date < new Date(new Date().setHours(0, 0, 0, 0))
                          }
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                    {errors.scheduledAt && (
                      <p className="text-sm text-destructive">
                        {errors.scheduledAt.message}
                      </p>
                    )}
                  </div>

                  {/* Time */}
                  <div className="space-y-2">
                    <Label>Waktu *</Label>
                    <Select
                      value={selectedTime}
                      onValueChange={setSelectedTime}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih waktu" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="05:30">
                          05:30 - Ba'da Subuh
                        </SelectItem>
                        <SelectItem value="06:00">06:00</SelectItem>
                        <SelectItem value="07:00">07:00</SelectItem>
                        <SelectItem value="08:00">08:00</SelectItem>
                        <SelectItem value="09:00">09:00</SelectItem>
                        <SelectItem value="10:00">10:00</SelectItem>
                        <SelectItem value="11:00">11:00</SelectItem>
                        <SelectItem value="13:30">
                          13:30 - Ba'da Dzuhur
                        </SelectItem>
                        <SelectItem value="14:00">14:00</SelectItem>
                        <SelectItem value="15:30">
                          15:30 - Ba'da Ashar
                        </SelectItem>
                        <SelectItem value="16:00">16:00</SelectItem>
                        <SelectItem value="18:30">
                          18:30 - Ba'da Maghrib
                        </SelectItem>
                        <SelectItem value="19:30">
                          19:30 - Ba'da Isya
                        </SelectItem>
                        <SelectItem value="20:00">20:00</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Topic */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5" />
                  Tema Percakapan (Opsional)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="topic">Tema / Situasi</Label>
                  <Textarea
                    id="topic"
                    placeholder="Contoh: Di pasar, membeli sayuran dan buah-buahan..."
                    {...register("topic")}
                    className="min-h-20"
                  />
                </div>

                {/* Topic Suggestions */}
                {selectedLanguage && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">
                      Saran Tema:
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {TOPIC_SUGGESTIONS[
                        selectedLanguage as keyof typeof TOPIC_SUGGESTIONS
                      ].map((topic) => (
                        <Badge
                          key={topic}
                          variant="outline"
                          className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                          onClick={() => setValue("topic", topic)}
                        >
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Summary */}
          <div className="space-y-6">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  Ringkasan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Language */}
                <div>
                  <p className="text-sm text-muted-foreground">Bahasa</p>
                  <p className="font-medium flex items-center gap-2">
                    {selectedLanguage === "Arabic" && "🕌 Bahasa Arab"}
                    {selectedLanguage === "English" && "🇬🇧 Bahasa Inggris"}
                  </p>
                </div>

                <Separator />

                {/* Participants */}
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Peserta</p>
                  <div className="space-y-2">
                    {selectedStudent ? (
                      <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {selectedStudent.name
                              ?.split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-sm">
                          <p className="font-medium">{selectedStudent.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {selectedStudent.nis}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Belum dipilih
                      </p>
                    )}
                    {selectedPartner && (
                      <>
                        <div className="text-center text-muted-foreground text-xs">
                          +
                        </div>
                        <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">
                              {selectedPartner.name
                                ?.split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="text-sm">
                            <p className="font-medium">
                              {selectedPartner.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {selectedPartner.nis}
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Schedule */}
                <div>
                  <p className="text-sm text-muted-foreground">Jadwal</p>
                  <p className="font-medium">
                    {selectedDate
                      ? format(selectedDate, "dd MMMM yyyy", {
                          locale: localeId,
                        })
                      : "-"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Pukul {selectedTime}
                  </p>
                </div>

                <Separator />

                {/* Topic */}
                <div>
                  <p className="text-sm text-muted-foreground">Tema</p>
                  <p className="font-medium line-clamp-2">
                    {watch("topic") || "Tidak ditentukan"}
                  </p>
                </div>

                <Separator />

                {/* Actions */}
                <div className="space-y-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isSubmitting || createMuhadatsah.isPending}
                  >
                    {isSubmitting || createMuhadatsah.isPending ? (
                      <>
                        <span className="animate-spin mr-2">⏳</span>
                        Menyimpan...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Simpan Jadwal
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => router.back()}
                  >
                    Batal
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Tips Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">💡 Tips Muhadatsah</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li>• Durasi ideal: 10-15 menit per sesi</li>
                  <li>• Gunakan kosa kata yang telah dipelajari</li>
                  <li>• Fokus pada kelancaran, bukan kesempurnaan</li>
                  <li>• Latih pengucapan dengan jelas</li>
                  <li>• Siapkan kosa kata terkait tema sebelumnya</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </MainLayout>
  );
}
