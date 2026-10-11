"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { useParams, useRouter } from "next/navigation";

import { id as localeId } from "date-fns/locale";
import {
  useTalentProfile,
  useCreateTalentAssessment as useCreateAssessment,
  useEnrollTraining,
} from "@/hooks/use-talenta";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { MainLayout } from "@/components/layout";
import {
  ArrowLeft,
  UserSquare2,
  TrendingUp,
  GraduationCap,
  Star,
  LineChart,
} from "lucide-react";

const assessmentSchema = z.object({
  period: z.string().min(1, "Periode wajib diisi (misal: Q1 2024)"),
  score: z.number().min(1).max(100),
  competencies: z.string().min(5, "Kompetensi wajib diisi"),
  potential: z.enum([
    "OUTSTANDING",
    "EXCEEDS",
    "MEETS",
    "BELOW",
    "UNSATISFACTORY",
  ]),
  recommendation: z.string().optional(),
});

function TalentProfileDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const profileId = params.id as string;

  const { data: profile, isLoading } = useTalentProfile(profileId);
  const createAssessment = useCreateAssessment();

  const [assessmentDialogOpen, setAssessmentDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof assessmentSchema>>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: {
      period: "",
      score: 75,
      competencies: "",
      potential: "MEETS",
      recommendation: "",
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container mx-auto py-20 text-center">
        <h2 className="text-2xl font-bold mb-2">
          Profil Talenta Tidak Ditemukan
        </h2>
        <Button onClick={() => router.back()}>Kembali</Button>
      </div>
    );
  }

  const onAssessmentSubmit = async (
    values: z.infer<typeof assessmentSchema>,
  ) => {
    // Convert competencies string to JSON array just for simple demo
    const competenciesJson = {
      items: values.competencies.split(",").map((s) => s.trim()),
    };

    await createAssessment.mutateAsync({
      talentId: profile.id,
      period: values.period,
      performanceRating: values.potential,
      potentialRating: values.potential,
      overallScore: values.score,
      competencies: competenciesJson,
      assessedAt: new Date().toISOString(),
    });
    setAssessmentDialogOpen(false);
    form.reset();
  };

  const getReadinessColor = (level: string) => {
    switch (level) {
      case "READY_NOW":
        return "bg-green-100 text-green-700";
      case "READY_LATER":
        return "bg-blue-100 text-blue-700";
      case "DEVELOPMENT":
        return "bg-yellow-100 text-yellow-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button
        variant="ghost"
        className="mb-2 -ml-4"
        onClick={() => router.back()}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Kembali
      </Button>

      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-primary/10 text-primary flex items-center justify-center rounded-full text-2xl font-bold">
            {profile.user?.name
              ? profile.user.name.substring(0, 2).toUpperCase()
              : "U"}
          </div>
          <div>
            <PageHeader
              title={profile.user?.name || "Karyawan Internal"}
              description={`Kategori Talenta: ${profile.category}`}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            className={`${getReadinessColor(profile.readinessLevel ?? "")} lg:text-sm px-3 py-1`}
          >
            Kesiapan: {(profile.readinessLevel ?? "-").replace("_", " ")}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserSquare2 className="w-4 h-4" /> Info Karyawan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs mb-1">
                  Status Karyawan
                </span>
                <span className="font-medium">Aktif</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-1">
                  Tgl Profil Dibuat
                </span>
                <span className="font-medium">
                  {safeFormat(new Date(profile.createdAt), "dd MMM yyyy", {
                    locale: localeId,
                  })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-1">
                  Terakhir Diperbarui
                </span>
                <span className="font-medium">
                  {safeFormat(new Date(profile.updatedAt), "dd MMM yyyy", {
                    locale: localeId,
                  })}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />{" "}
                9-Box Grid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center p-4 bg-background rounded-md border">
                <p className="text-xs text-muted-foreground mb-1">
                  Performa Terakhir
                </p>
                <div className="text-2xl font-bold text-primary">
                  {profile.assessments && profile.assessments.length > 0
                    ? `${profile.assessments[0].score}/100`
                    : "N/A"}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-3">
          <Tabs defaultValue="assessments">
            <div className="border-b mb-4">
              <TabsList className="bg-transparent border-none">
                <TabsTrigger
                  value="assessments"
                  className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                >
                  <TrendingUp className="w-4 h-4 mr-2" /> Penilaian Format &
                  Potensi
                </TabsTrigger>
                <TabsTrigger
                  value="trainings"
                  className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
                >
                  <GraduationCap className="w-4 h-4 mr-2" /> Riwayat Pelatihan
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="assessments" className="space-y-4 m-0">
              <div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg border">
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <LineChart className="w-5 h-5 text-primary" /> Riwayat
                    Penilaian
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Evaluasi berkala kompetensi dan potensi pengembangan karir.
                  </p>
                </div>
                <Dialog
                  open={assessmentDialogOpen}
                  onOpenChange={setAssessmentDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button size="sm">+ Asesmen Baru</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Input Asesmen Berkala</DialogTitle>
                      <DialogDescription>
                        Tambahkan rekam jejak performa dan potensi talenta ini.
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                      <form
                        onSubmit={form.handleSubmit(onAssessmentSubmit)}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="period"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Periode</FormLabel>
                                <FormControl>
                                  <Input placeholder="Q1 2024" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="score"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Skor Performa (1-100)</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    {...field}
                                    onChange={(e) =>
                                      field.onChange(Number(e.target.value))
                                    }
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={form.control}
                          name="potential"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Tingkat Potensi</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Pilih potensi" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="OUTSTANDING">
                                    Sangat Baik (Outstanding)
                                  </SelectItem>
                                  <SelectItem value="EXCEEDS">
                                    Melampaui Ekspektasi (Exceeds)
                                  </SelectItem>
                                  <SelectItem value="MEETS">
                                    Memenuhi Ekspektasi (Meets)
                                  </SelectItem>
                                  <SelectItem value="BELOW">
                                    Di Bawah Ekspektasi (Below)
                                  </SelectItem>
                                  <SelectItem value="UNSATISFACTORY">
                                    Tidak Memuaskan (Unsatisfactory)
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="competencies"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Ringkasan Kompetensi (pisahkan dgn koma)
                              </FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Leadership, Komunikasi, Teknis..."
                                  rows={2}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="recommendation"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Rekomendasi Pengembangan</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Tindakan yang disarankan..."
                                  rows={2}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end gap-2 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAssessmentDialogOpen(false)}
                          >
                            Batal
                          </Button>
                          <Button
                            type="submit"
                            disabled={createAssessment.isPending}
                          >
                            {createAssessment.isPending
                              ? "Menyimpan..."
                              : "Simpan Asesmen"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              {profile.assessments && profile.assessments.length > 0 ? (
                <div className="space-y-4">
                  {profile.assessments.map((ast: any) => (
                    <Card key={ast.id} className="overflow-hidden">
                      <div className="bg-muted p-3 border-b flex justify-between items-center">
                        <span className="font-semibold">{ast.period}</span>
                        <Badge variant="outline" className="bg-background">
                          Skor: {Number(ast.overallScore)}
                        </Badge>
                      </div>
                      <CardContent className="p-4 grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground block mb-1 text-xs font-bold">
                            TINGKAT POTENSI
                          </span>
                          <Badge variant="secondary">
                            {ast.potentialRating}
                          </Badge>
                        </div>
                        {ast.assessor && (
                          <div>
                            <span className="text-muted-foreground block mb-1 text-xs font-bold">
                              EVALUATOR
                            </span>
                            <span>{ast.assessor.name}</span>
                          </div>
                        )}
                        <div className="col-span-2 mt-2">
                          <span className="text-muted-foreground block mb-1 text-xs font-bold">
                            KOMPETENSI KUNCI
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {ast.competencies?.items?.map(
                              (item: string, i: number) => (
                                <Badge
                                  key={i}
                                  variant="outline"
                                  className="text-xs font-normal bg-blue-50/50"
                                >
                                  {item}
                                </Badge>
                              ),
                            ) || (
                              <span className="text-muted-foreground italic">
                                Tidak ada rincian kompetensi
                              </span>
                            )}
                          </div>
                        </div>
                        {ast.recommendation && (
                          <div className="col-span-2 mt-2 p-3 bg-yellow-50/50 rounded border border-yellow-100/50">
                            <span className="text-yellow-800 block mb-1 text-xs font-bold">
                              REKOMENDASI
                            </span>
                            <p className="text-yellow-900">
                              {ast.recommendation}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground border border-dashed rounded-lg">
                  <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>Belum ada rekaman asesmen untuk talenta ini.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="trainings" className="m-0">
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>
                    Daftar riwayat pelatihan yang diikuti karyawan akan muncul
                    di sini.
                  </p>
                  <Button variant="outline" className="mt-4">
                    Daftarkan ke Program Pelatihan
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

export default function TalentProfileDetailPage() {
  return (
    <MainLayout>
      <TalentProfileDetailPageContent />
    </MainLayout>
  );
}
