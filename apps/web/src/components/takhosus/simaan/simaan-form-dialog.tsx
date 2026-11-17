"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { SimaanTypeEnum, SimaanGradeEnum } from "@cipansor/shared";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  useCreateSimaan,
  useUpdateSimaan,
  SIMAAN_TYPES,
  SIMAAN_GRADES,
  SimaanExam,
} from "@/hooks/use-simaan";
import { useUsers } from "@/hooks/use-users";

/**
 * The dialog edits a `SimaanExam` — the same fields the API's shared contract
 * has (#1024). It used to send an ISO datetime, a `SIMAAN_TYPES` value the API
 * did not have, and `grade: ""`; now the date is "yyyy-MM-dd", the type is the
 * shared enum, and an empty grade is omitted on create and sent as `null` on
 * update (to clear a value that is already there).
 */
const formSchema = z
  .object({
    simaanType: SimaanTypeEnum,
    examDate: z.date(),
    sessionNumber: z.coerce.number().int().min(1),
    totalSessions: z.coerce.number().int().min(1),
    juzStart: z.coerce.number().int().min(1).max(30),
    juzEnd: z.coerce.number().int().min(1).max(30),
    overallScore: z.coerce.number().min(0).max(100).optional(),
    tajwidScore: z.coerce.number().min(0).max(100).optional(),
    fashohaScore: z.coerce.number().min(0).max(100).optional(),
    tartilScore: z.coerce.number().min(0).max(100).optional(),
    grade: SimaanGradeEnum.optional(),
    passed: z.boolean(),
    notes: z.string().max(2000).optional(),
    recommendations: z.string().max(2000).optional(),
  })
  .refine((data) => data.juzEnd >= data.juzStart, {
    message: "Juz Akhir harus lebih besar atau sama dengan Juz Awal",
    path: ["juzEnd"],
  });

interface SimaanFormDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  studentId: string;
  initialData?: SimaanExam;
  enrollmentId?: string;
  halaqohId?: string;
  trigger?: React.ReactNode;
}

export function SimaanFormDialog({
  open,
  onOpenChange,
  studentId,
  initialData,
  enrollmentId,
  halaqohId,
  trigger,
}: SimaanFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof open !== "undefined";
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? onOpenChange : setInternalOpen;

  const createSimaan = useCreateSimaan();
  const updateSimaan = useUpdateSimaan();

  // Fetch teachers for examiners (reserved for future examiner selection implementation)
  useUsers({ role: "TEACHER", limit: 100 });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      simaanType: initialData?.simaanType || "BIN_NAZHR",
      examDate: initialData?.examDate
        ? new Date(initialData.examDate)
        : new Date(),
      sessionNumber: initialData?.sessionNumber || 1,
      totalSessions: initialData?.totalSessions || 1,
      juzStart: initialData?.juzStart || 1,
      juzEnd: initialData?.juzEnd || 1,
      overallScore: initialData?.overallScore,
      tajwidScore: initialData?.tajwidScore,
      fashohaScore: initialData?.fashohaScore,
      tartilScore: initialData?.tartilScore,
      grade: initialData?.grade ?? undefined,
      passed: initialData?.passed || false,
      notes: initialData?.notes || "",
      recommendations: initialData?.recommendations || "",
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      // An empty grade is omitted on create and sent as `null` on update, so
      // the shared contract never sees `""` (which it would reject).
      const grade = values.grade ?? undefined;
      if (initialData) {
        await updateSimaan.mutateAsync({
          id: initialData.id,
          data: {
            ...values,
            examDate: format(values.examDate, "yyyy-MM-dd"),
            grade: grade ?? null,
          },
        });
        toast.success("Data simaan berhasil diperbarui");
      } else {
        await createSimaan.mutateAsync({
          studentId,
          enrollmentId,
          halaqohId,
          ...values,
          examDate: format(values.examDate, "yyyy-MM-dd"),
          grade,
          examinerIds: [],
        });
        toast.success("Jadwal simaan berhasil dibuat");
      }
      setIsOpen?.(false);
      form.reset();
    } catch (error: unknown) {
      const err = error as Error;
      toast.error(err.message || "Terjadi kesalahan");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData ? "Edit Simaan" : "Jadwalkan Simaan / Ujian"}
          </DialogTitle>
          <DialogDescription>
            Atur jadwal dan detail ujian hafalan santri.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="simaanType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Jenis Ujian</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih jenis" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SIMAAN_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
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
                name="examDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Tanggal Ujian</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pilih tanggal</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <FormField
                control={form.control}
                name="juzStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Juz Mulai</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={30} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="juzEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Juz Akhir</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} max={30} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sessionNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sesi Ke</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="totalSessions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Sesi</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Scoring Section - Can be filled later or now */}
            <div className="border rounded-md p-4 bg-muted/10 space-y-4">
              <h3 className="font-medium text-sm">
                Penilaian (Opsional saat penjadwalan)
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <FormField
                  control={form.control}
                  name="overallScore"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nilai Total</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          {...field}
                          value={field.value || ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value
                                ? parseFloat(e.target.value)
                                : undefined,
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tajwidScore"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tajwid</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          {...field}
                          value={field.value || ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value
                                ? parseFloat(e.target.value)
                                : undefined,
                            )
                          }
                        />
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
                      <FormLabel>Fashoha</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          {...field}
                          value={field.value || ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value
                                ? parseFloat(e.target.value)
                                : undefined,
                            )
                          }
                        />
                      </FormControl>
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
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="-" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SIMAAN_GRADES.map((grade) => (
                            <SelectItem key={grade.value} value={grade.value}>
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
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-background">
                    <FormControl>
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={field.onChange}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Lulus Ujian</FormLabel>
                      <FormDescription>
                        Centang jika santri dinyatakan lulus ujian ini.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Catatan</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Catatan ujian..." {...field} />
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
                    <FormLabel>Rekomendasi</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Rekomendasi penguji..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen?.(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={createSimaan.isPending || updateSimaan.isPending}
              >
                {createSimaan.isPending || updateSimaan.isPending
                  ? "Menyimpan..."
                  : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
