"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MainLayout } from "@/components/layout";
import { PageHeader } from "@/components/shared";
import { useCreateMurojaah } from "@/hooks/use-murojaah";
import { useClasses } from "@/hooks/use-classes";
import { useStudents } from "@/hooks/use-students";
import { useTeachers } from "@/hooks/use-teachers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ArrowLeft, CalendarIcon, Save, Loader2, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { useState } from "react";

// Daftar Surah Al-Qur'an
const SURAH_LIST = [
  { id: "1", name: "Al-Fatihah", totalAyat: 7 },
  { id: "2", name: "Al-Baqarah", totalAyat: 286 },
  { id: "3", name: "Ali Imran", totalAyat: 200 },
  { id: "4", name: "An-Nisa", totalAyat: 176 },
  { id: "5", name: "Al-Maidah", totalAyat: 120 },
  { id: "78", name: "An-Naba", totalAyat: 40 },
  { id: "79", name: "An-Naziat", totalAyat: 46 },
  { id: "80", name: "Abasa", totalAyat: 42 },
  { id: "81", name: "At-Takwir", totalAyat: 29 },
  { id: "82", name: "Al-Infitar", totalAyat: 19 },
  { id: "83", name: "Al-Mutaffifin", totalAyat: 36 },
  { id: "84", name: "Al-Insyiqaq", totalAyat: 25 },
  { id: "85", name: "Al-Buruj", totalAyat: 22 },
  { id: "86", name: "At-Tariq", totalAyat: 17 },
  { id: "87", name: "Al-Ala", totalAyat: 19 },
  { id: "88", name: "Al-Ghasyiyah", totalAyat: 26 },
  { id: "89", name: "Al-Fajr", totalAyat: 30 },
  { id: "90", name: "Al-Balad", totalAyat: 20 },
  { id: "91", name: "Asy-Syams", totalAyat: 15 },
  { id: "92", name: "Al-Lail", totalAyat: 21 },
  { id: "93", name: "Ad-Duha", totalAyat: 11 },
  { id: "94", name: "Asy-Syarh", totalAyat: 8 },
  { id: "95", name: "At-Tin", totalAyat: 8 },
  { id: "96", name: "Al-Alaq", totalAyat: 19 },
  { id: "97", name: "Al-Qadr", totalAyat: 5 },
  { id: "98", name: "Al-Bayyinah", totalAyat: 8 },
  { id: "99", name: "Az-Zalzalah", totalAyat: 8 },
  { id: "100", name: "Al-Adiyat", totalAyat: 11 },
  { id: "101", name: "Al-Qariah", totalAyat: 11 },
  { id: "102", name: "At-Takasur", totalAyat: 8 },
  { id: "103", name: "Al-Asr", totalAyat: 3 },
  { id: "104", name: "Al-Humazah", totalAyat: 9 },
  { id: "105", name: "Al-Fil", totalAyat: 5 },
  { id: "106", name: "Quraisy", totalAyat: 4 },
  { id: "107", name: "Al-Maun", totalAyat: 7 },
  { id: "108", name: "Al-Kausar", totalAyat: 3 },
  { id: "109", name: "Al-Kafirun", totalAyat: 6 },
  { id: "110", name: "An-Nasr", totalAyat: 3 },
  { id: "111", name: "Al-Lahab", totalAyat: 5 },
  { id: "112", name: "Al-Ikhlas", totalAyat: 4 },
  { id: "113", name: "Al-Falaq", totalAyat: 5 },
  { id: "114", name: "An-Nas", totalAyat: 6 },
];

const murojaahSchema = z
  .object({
    studentId: z.string().min(1, "Santri wajib dipilih"),
    teacherId: z.string().min(1, "Musyrif wajib dipilih"),
    date: z.date({ error: "Tanggal wajib diisi" }),
    surahId: z.string().min(1, "Surah wajib dipilih"),
    startAyat: z.number().min(1, "Ayat awal wajib diisi"),
    endAyat: z.number().min(1, "Ayat akhir wajib diisi"),
    repetitions: z.number().min(1, "Minimal 1x pengulangan"),
    notes: z.string().optional(),
  })
  .refine((data) => data.endAyat >= data.startAyat, {
    message: "Ayat akhir harus lebih besar atau sama dengan ayat awal",
    path: ["endAyat"],
  });

type MurojaahFormData = z.infer<typeof murojaahSchema>;

export default function CreateMurojaahPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedSurah, setSelectedSurah] = useState<
    (typeof SURAH_LIST)[0] | null
  >(null);

  const { data: classes } = useClasses({ unitId: user?.unitId });
  const { data: students } = useStudents({
    classId: selectedClassId || undefined,
    unitId: user?.unitId,
    limit: 100,
  });
  const { data: teachers } = useTeachers({ unitId: user?.unitId });

  const createMutation = useCreateMurojaah();

  const form = useForm<MurojaahFormData>({
    resolver: zodResolver(murojaahSchema),
    defaultValues: {
      studentId: "",
      teacherId: "",
      date: new Date(),
      surahId: "",
      startAyat: 1,
      endAyat: 1,
      repetitions: 3,
      notes: "",
    },
  });

  const onSubmit = async (data: MurojaahFormData) => {
    const surah = SURAH_LIST.find((s) => s.id === data.surahId);
    if (!surah) {
      toast.error("Surah tidak valid");
      return;
    }

    try {
      await createMutation.mutateAsync({
        ...data,
        murojaahDate: format(data.date, "yyyy-MM-dd"),
        murojaahType: "YAUMIYAH", // Harian, the default type
        juzStart: 1, // Placeholder as form only has surah/ayat
        juzEnd: 1, // Placeholder
        pagesReviewed: 1, // Placeholder
        durationMinutes: 30, // Placeholder
        qualityScore: 0, // Placeholder
      });
      toast.success("Record murojaah berhasil dibuat");
      router.push("/tahfidz/murojaah");
    } catch {
      toast.error("Gagal membuat record murojaah");
    }
  };

  const handleSurahChange = (surahId: string) => {
    const surah = SURAH_LIST.find((s) => s.id === surahId);
    setSelectedSurah(surah || null);
    form.setValue("surahId", surahId);
    form.setValue("startAyat", 1);
    form.setValue("endAyat", surah?.totalAyat || 1);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <PageHeader
          title="Tambah Murojaah"
          description="Catat pengulangan hafalan santri"
          actions={
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Kembali
            </Button>
          }
        />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Informasi Dasar</CardTitle>
                <CardDescription>
                  Data santri, musyrif, dan tanggal
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                {/* Class filter */}
                <div className="space-y-2">
                  <Label>Filter Kelas/Halaqah</Label>
                  <Select
                    value={selectedClassId}
                    onValueChange={setSelectedClassId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Semua kelas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Semua Kelas</SelectItem>
                      {classes?.data?.map((cls) => (
                        <SelectItem key={cls.id} value={cls.id}>
                          {cls.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <FormField
                  control={form.control}
                  name="studentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Santri *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih santri" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {students?.data?.map((student) => (
                            <SelectItem key={student.id} value={student.id}>
                              {student.name} ({student.nis})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="teacherId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Musyrif *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih musyrif" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {teachers?.data?.map((teacher) => (
                            <SelectItem key={teacher.id} value={teacher.id}>
                              {teacher.user?.name || teacher.nip}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tanggal *</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground",
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value
                                ? format(field.value, "dd MMMM yyyy", {
                                    locale: idLocale,
                                  })
                                : "Pilih tanggal"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            locale={idLocale}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Surah & Ayat */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Surah & Ayat
                </CardTitle>
                <CardDescription>
                  Tentukan surah dan rentang ayat yang dimurojaah
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="surahId"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Surah *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={handleSurahChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih surah" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SURAH_LIST.map((surah) => (
                            <SelectItem key={surah.id} value={surah.id}>
                              {surah.id}. {surah.name} ({surah.totalAyat} ayat)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="startAyat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ayat Awal *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={selectedSurah?.totalAyat || 999}
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value) || 1)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {selectedSurah && `Max: ${selectedSurah.totalAyat}`}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endAyat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ayat Akhir *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={selectedSurah?.totalAyat || 999}
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value) || 1)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {selectedSurah && `Max: ${selectedSurah.totalAyat}`}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="repetitions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Jumlah Pengulangan *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value) || 1)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Berapa kali ayat diulang
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Catatan</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Catatan tambahan tentang murojaah..."
                          rows={4}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Batal
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Simpan
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </MainLayout>
  );
}
