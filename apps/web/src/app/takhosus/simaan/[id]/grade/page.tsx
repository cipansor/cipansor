"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import * as z from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useSimaanExam,
  useSubmitSimaanScores,
  SIMAAN_GRADES,
} from "@/hooks/use-simaan";
import { toast } from "sonner";
import { DetailItem } from "@/components/shared/detail-item";
import { Separator } from "@/components/ui/separator";

import { MainLayout } from "@/components/layout";
const formSchema = z.object({
  tajwidScore: z.coerce.number().min(0).max(100),
  fashohaScore: z.coerce.number().min(0).max(100),
  tartilScore: z.coerce.number().min(0).max(100),
  overallScore: z.coerce.number().min(0).max(100),
  grade: z.string().min(1, "Predikat harus dipilih"),
  passed: z.boolean(),
  notes: z.string().optional(),
  recommendations: z.string().optional(),
});

function GradeSimaanPageContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: exam, isLoading } = useSimaanExam(params.id);
  const { mutate: submitScores, isPending } = useSubmitSimaanScores();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tajwidScore: 0,
      fashohaScore: 0,
      tartilScore: 0,
      overallScore: 0,
      grade: "",
      passed: false,
      notes: "",
      recommendations: "",
    },
  });

  // Load existing data if available
  useEffect(() => {
    if (exam) {
      form.reset({
        tajwidScore: exam.tajwidScore || 0,
        fashohaScore: exam.fashohaScore || 0,
        tartilScore: exam.tartilScore || 0,
        overallScore: exam.overallScore || 0,
        grade: exam.grade || "",
        passed: exam.passed,
        notes: exam.notes || "",
        recommendations: exam.recommendations || "",
      });
    }
  }, [exam, form]);

  // Auto-calculate overall score if individual scores change
  const tajwid = form.watch("tajwidScore");
  const fashoha = form.watch("fashohaScore");
  const tartil = form.watch("tartilScore");

  useEffect(() => {
    if (exam && !exam.overallScore) {
      // Only auto-calc if not manually overridden or first load
      const avg = Math.round((tajwid + fashoha + tartil) / 3);
      form.setValue("overallScore", avg);

      // Auto-suggest grade and pass status
      if (avg >= 95) form.setValue("grade", "MUMTAZ");
      else if (avg >= 85) form.setValue("grade", "JAYYID_JIDDAN");
      else if (avg >= 75) form.setValue("grade", "JAYYID");
      else if (avg >= 60) form.setValue("grade", "MAQBUL");
      else form.setValue("grade", "RASIB");

      form.setValue("passed", avg >= 60);
    }
  }, [tajwid, fashoha, tartil, form, exam]);

  function onSubmit(values: z.infer<typeof formSchema>) {
    submitScores(
      { id: params.id, data: values },
      {
        onSuccess: () => {
          toast.success("Nilai simaan berhasil disimpan");
          router.push("/takhosus/simaan");
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onError: (error: any) => {
          toast.error(
            error?.response?.data?.message || "Gagal menyimpan nilai",
          );
        },
      },
    );
  }

  if (isLoading) return <div>Loading...</div>;
  if (!exam) return <div>Data not found</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Penilaian Simaan"
        description={`Input nilai untuk ${exam.student?.user?.name || "Santri"}`}
        backHref="/takhosus/simaan"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Detail Ujian</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailItem label="Santri" value={exam.student?.user?.name} />
              <DetailItem label="NIS" value={exam.student?.nis} />
              <Separator />
              <DetailItem label="Jenis" value={exam.simaanType} />
              <DetailItem
                label="Juz"
                value={`${exam.juzStart} - ${exam.juzEnd}`}
              />
              <DetailItem
                label="Tanggal"
                value={new Date(exam.examDate).toLocaleDateString("id-ID")}
              />
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Formulir Penilaian</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-6"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="tajwidScore"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nilai Tajwid</FormLabel>
                          <FormControl>
                            <Input type="number" min={0} max={100} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="fashohaScore"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nilai Fashohah</FormLabel>
                          <FormControl>
                            <Input type="number" min={0} max={100} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tartilScore"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nilai Tartil/Kelancaran</FormLabel>
                          <FormControl>
                            <Input type="number" min={0} max={100} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control}
                      name="overallScore"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-lg font-semibold">
                            Nilai Akhir (Rata-rata)
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              {...field}
                              className="text-lg font-bold"
                            />
                          </FormControl>
                          <FormDescription>
                            Dihitung otomatis atau input manual
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="grade"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Predikat</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih predikat" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {SIMAAN_GRADES.map((grade) => (
                                <SelectItem
                                  key={grade.value}
                                  value={grade.value}
                                >
                                  {grade.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="passed"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">
                            Lulus Ujian?
                          </FormLabel>
                          <FormDescription>
                            Tandai jika santri dinyatakan lulus simaan ini.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Catatan (Opsional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Catatan tambahan..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="recommendations"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rekomendasi (Opsional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Rekomendasi tindak lanjut..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.back()}
                    >
                      Batal
                    </Button>
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Menyimpan..." : "Simpan Nilai"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function GradeSimaanPage({
  params,
}: {
  params: Promise<Parameters<typeof GradeSimaanPageContent>[0]["params"]>;
}) {
  const resolved = use(params);
  return (
    <MainLayout>
      <GradeSimaanPageContent params={resolved} />
    </MainLayout>
  );
}
