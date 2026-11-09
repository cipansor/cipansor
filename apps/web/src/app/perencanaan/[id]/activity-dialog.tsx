"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useActivityBudgetOptions,
  useActivityPicOptions,
  useCreateActivity,
  useUpdateActivity,
} from "@/hooks/use-perencanaan";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const activitySchema = z.object({
  title: z.string().min(3, "Judul minimal 3 karakter"),
  description: z.string().optional(),
  picId: z.string().optional(),
  budgetId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: z.string().optional(),
});

type ActivityFormValues = z.infer<typeof activitySchema>;

interface ActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectiveId: string;
  editData?: any;
}

export function ActivityDialog({
  open,
  onOpenChange,
  objectiveId,
  editData,
}: ActivityDialogProps) {
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const isEdit = !!editData;

  const { data: budgets } = useActivityBudgetOptions();
  const { data: users } = useActivityPicOptions();
  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      title: editData?.title || "",
      description: editData?.description || "",
      picId: editData?.picId || "none",
      budgetId: editData?.budgetId || "none",
      priority: editData?.priority || "MEDIUM",
      startDate: editData?.startDate
        ? new Date(editData.startDate).toISOString().split("T")[0]
        : "",
      endDate: editData?.endDate
        ? new Date(editData.endDate).toISOString().split("T")[0]
        : "",
      budget: editData?.budget ? String(editData.budget) : "",
    },
  });

  const onSubmit = async (values: ActivityFormValues) => {
    const payload = {
      ...values,
      objectiveId,
      picId: values.picId && values.picId !== "none" ? values.picId : null,
      budgetId:
        values.budgetId && values.budgetId !== "none" ? values.budgetId : null,
      budget: values.budget ? Number(values.budget) : undefined,
      startDate: values.startDate
        ? new Date(values.startDate).toISOString()
        : undefined,
      endDate: values.endDate
        ? new Date(values.endDate).toISOString()
        : undefined,
    };

    if (isEdit) {
      await updateActivity.mutateAsync({ id: editData.id, ...payload });
    } else {
      await createActivity.mutateAsync(payload);
    }
    onOpenChange(false);
    form.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Kegiatan" : "Tambah Kegiatan"}
          </DialogTitle>
          <DialogDescription>
            Tentukan detail program atau kegiatan untuk sasaran ini.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nama Kegiatan</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="cth: Pelatihan Guru Tahfidz"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prioritas</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih prioritas" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="LOW">Rendah</SelectItem>
                      <SelectItem value="MEDIUM">Sedang</SelectItem>
                      <SelectItem value="HIGH">Tinggi</SelectItem>
                      <SelectItem value="CRITICAL">Kritikal</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="picId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Penanggung Jawab (PIC)</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih PIC" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Tanpa PIC</SelectItem>
                      {users?.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
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
              name="budgetId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link ke Anggaran Keuangan (Finance)</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih anggaran" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">
                        Tanpa Anggaran Keuangan
                      </SelectItem>
                      {budgets?.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.account?.code} - {b.account?.name} (Tersedia: Rp{" "}
                          {Number(b.amount || 0).toLocaleString("id-ID")})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tgl Mulai</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tgl Selesai</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={createActivity.isPending || updateActivity.isPending}
              >
                Simpan
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
