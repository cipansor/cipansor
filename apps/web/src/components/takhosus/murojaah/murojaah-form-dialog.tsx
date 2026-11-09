"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { StudentSelect } from "@/components/shared/student-select";
import {
  useCreateMurojaah,
  useUpdateMurojaah,
  MUROJAAH_TYPES,
  MISTAKE_TYPES,
  MurojaahRecord,
} from "@/hooks/use-murojaah";

const mistakeSchema = z.object({
  mistakeType: z.string(),
  juz: z.coerce.number().min(1).max(30),
  surahNumber: z.coerce.number().min(1).max(114),
  ayahNumber: z.coerce.number().min(1).optional(),
  description: z.string().optional(),
});

const formSchema = z
  .object({
    murojaahType: z.string(),
    murojaahDate: z.date(),
    juzStart: z.coerce.number().min(1).max(30),
    juzEnd: z.coerce.number().min(1).max(30),
    pagesReviewed: z.coerce.number().min(1).max(620),
    durationMinutes: z.coerce.number().min(1),
    qualityScore: z.coerce.number().min(0).max(100),
    fluencyLevel: z.coerce.number().min(1).max(5),
    tajwidScore: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().optional(),
    improvementAreas: z.string().optional(),
    mistakes: z.array(mistakeSchema).optional(),
  })
  .refine((data) => data.juzEnd >= data.juzStart, {
    message: "Juz Akhir harus lebih besar atau sama dengan Juz Awal",
    path: ["juzEnd"],
  });

interface MurojaahFormDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  studentId?: string;
  initialData?: MurojaahRecord;
  enrollmentId?: string;
  halaqohId?: string;
  trigger?: React.ReactNode;
}

export function MurojaahFormDialog({
  open,
  onOpenChange,
  studentId: propStudentId,
  initialData,
  enrollmentId,
  halaqohId,
  trigger,
}: MurojaahFormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [mistakes, setMistakes] = useState<z.infer<typeof mistakeSchema>[]>(
    initialData?.mistakes?.map((m) => ({
      mistakeType: m.mistakeType,
      juz: m.juz,
      surahNumber: m.surahNumber,
      ayahNumber: m.ayahNumber,
      description: m.description,
    })) || [],
  );

  const studentId = propStudentId || selectedStudentId;

  const isControlled = typeof open !== "undefined";
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? onOpenChange : setInternalOpen;

  const createMurojaah = useCreateMurojaah();
  const updateMurojaah = useUpdateMurojaah();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      murojaahType: initialData?.murojaahType || "YAUMIYAH",
      murojaahDate: initialData?.murojaahDate
        ? new Date(initialData.murojaahDate)
        : new Date(),
      juzStart: initialData?.juzStart || 1,
      juzEnd: initialData?.juzEnd || 1,
      pagesReviewed: initialData?.pagesReviewed || 10,
      durationMinutes: initialData?.durationMinutes || 30,
      qualityScore: initialData?.qualityScore || 80,
      fluencyLevel: initialData?.fluencyLevel || 3,
      tajwidScore: initialData?.tajwidScore,
      notes: initialData?.notes || "",
      improvementAreas: initialData?.improvementAreas || "",
      mistakes: [],
    },
  });

  // Reset form when dialog state changes
  useEffect(() => {
    if (!isOpen) {
      form.reset();
      setMistakes([]);
      setSelectedStudentId("");
    } else if (!initialData) {
      // Ensure date is fresh when opening in create mode
      form.setValue("murojaahDate", new Date());
    }
  }, [isOpen, form, initialData]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (initialData) {
        await updateMurojaah.mutateAsync({
          id: initialData.id,
          data: {
            ...values,
            murojaahDate: values.murojaahDate.toISOString(),
          },
        });
        toast.success("Data murojaah berhasil diperbarui");
      } else {
        if (!studentId) {
          toast.error("Silakan pilih santri terlebih dahulu");
          return;
        }

        await createMurojaah.mutateAsync({
          studentId,
          enrollmentId,
          halaqohId,
          ...values,
          murojaahDate: values.murojaahDate.toISOString(),
          mistakes,
        });
        toast.success("Data murojaah berhasil ditambahkan");
      }
      setIsOpen?.(false);
      form.reset();
      setMistakes([]);
      setSelectedStudentId("");
    } catch (error: unknown) {
      const err = error as Error;
      toast.error(err.message || "Terjadi kesalahan");
    }
  };

  const addMistake = () => {
    setMistakes([
      ...mistakes,
      {
        mistakeType: "LAHN_JALI",
        juz: form.getValues("juzStart"),
        surahNumber: 1,
        ayahNumber: 1,
      },
    ]);
  };

  const removeMistake = (index: number) => {
    setMistakes(mistakes.filter((_, i) => i !== index));
  };

  const updateMistake = (index: number, field: string, value: any) => {
    const newMistakes = [...mistakes];
    newMistakes[index] = { ...newMistakes[index], [field]: value };
    setMistakes(newMistakes);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData ? "Edit Murojaah" : "Tambah Catatan Murojaah"}
          </DialogTitle>
          <DialogDescription>
            Catat hasil setoran atau murojaah harian santri.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {!initialData && !propStudentId && (
              <div className="space-y-2">
                <FormLabel>Santri</FormLabel>
                <StudentSelect
                  value={selectedStudentId}
                  onValueChange={setSelectedStudentId}
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="murojaahType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Jenis Murojaah</FormLabel>
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
                        {MUROJAAH_TYPES.map((type) => (
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
                name="murojaahDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Tanggal</FormLabel>
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
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
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
                name="pagesReviewed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Halaman</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="durationMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Durasi (Menit)</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="qualityScore"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nilai Kelancaran (0-100)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={100} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fluencyLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Level (1-5)</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(parseInt(v))}
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih level" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="5">5 - Sangat Lancar</SelectItem>
                        <SelectItem value="4">4 - Lancar</SelectItem>
                        <SelectItem value="3">3 - Cukup</SelectItem>
                        <SelectItem value="2">2 - Kurang</SelectItem>
                        <SelectItem value="1">1 - Terbata-bata</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tajwidScore"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nilai Tajwid (Opsional)</FormLabel>
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
                              ? parseInt(e.target.value)
                              : undefined,
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
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
                      <Textarea placeholder="Catatan tambahan..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="improvementAreas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Area Perbaikan</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Hal yang perlu diperbaiki..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Mistakes Section */}
            {!initialData && (
              <div className="space-y-4 border rounded-md p-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">
                    Daftar Kesalahan ({mistakes.length})
                  </h4>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addMistake}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Tambah Kesalahan
                  </Button>
                </div>

                {mistakes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Tidak ada kesalahan yang dicatat.
                  </p>
                )}

                {mistakes.map((mistake, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-12 gap-2 items-end border-b pb-4 last:border-0 last:pb-0"
                  >
                    <div className="col-span-12 md:col-span-3">
                      <FormLabel className="text-xs">Jenis</FormLabel>
                      <Select
                        value={mistake.mistakeType}
                        onValueChange={(v) =>
                          updateMistake(index, "mistakeType", v)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MISTAKE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      <FormLabel className="text-xs">Juz</FormLabel>
                      <Input
                        type="number"
                        className="h-8 text-xs"
                        value={mistake.juz}
                        onChange={(e) =>
                          updateMistake(index, "juz", parseInt(e.target.value))
                        }
                      />
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      <FormLabel className="text-xs">Surah #</FormLabel>
                      <Input
                        type="number"
                        className="h-8 text-xs"
                        value={mistake.surahNumber}
                        onChange={(e) =>
                          updateMistake(
                            index,
                            "surahNumber",
                            parseInt(e.target.value),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-3 md:col-span-2">
                      <FormLabel className="text-xs">Ayat</FormLabel>
                      <Input
                        type="number"
                        className="h-8 text-xs"
                        value={mistake.ayahNumber}
                        onChange={(e) =>
                          updateMistake(
                            index,
                            "ayahNumber",
                            parseInt(e.target.value),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-11 md:col-span-2">
                      <FormLabel className="text-xs">Ket</FormLabel>
                      <Input
                        className="h-8 text-xs"
                        value={mistake.description || ""}
                        onChange={(e) =>
                          updateMistake(index, "description", e.target.value)
                        }
                        placeholder="Ket..."
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeMistake(index)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

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
                disabled={createMurojaah.isPending || updateMurojaah.isPending}
              >
                {createMurojaah.isPending || updateMurojaah.isPending
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
