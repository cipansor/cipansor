"use client";

import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
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
import {
  useCreateLeaveRequest,
  useEmployees,
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
} from "@/hooks";
import { useAcademicYears } from "@/hooks/use-academic-years";
import { useLeaveBalances } from "@/hooks/use-leave-balances";
import { ArrowLeft, Save, Loader2, Calendar, Info } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { differenceInDays } from "date-fns";

const leaveRequestSchema = z
  .object({
    employeeId: z.string().min(1, "Karyawan wajib dipilih"),
    leaveType: z.enum(
      [
        "ANNUAL",
        "SICK",
        "MATERNITY",
        "PATERNITY",
        "MARRIAGE",
        "BEREAVEMENT",
        "UNPAID",
        "OTHER",
      ],
      {
        error: "Jenis cuti wajib dipilih",
      },
    ),
    startDate: z.string().min(1, "Tanggal mulai wajib diisi"),
    endDate: z.string().min(1, "Tanggal selesai wajib diisi"),
    reason: z.string().min(10, "Alasan minimal 10 karakter"),
    attachmentUrl: z.string().optional(),
  })
  .refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
    message: "Tanggal selesai harus setelah tanggal mulai",
    path: ["endDate"],
  });

type LeaveRequestFormData = z.infer<typeof leaveRequestSchema>;

export default function NewLeavePage() {
  const router = useRouter();
  const createLeaveRequest = useCreateLeaveRequest();

  const { data: employeesData } = useEmployees({ status: "ACTIVE" });
  const employees = employeesData?.data || [];

  const { data: academicYearsData } = useAcademicYears({ isActive: true });
  const activeAcademicYear = academicYearsData?.data?.[0];

  const form = useForm<LeaveRequestFormData>({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: {
      employeeId: "",
      leaveType: undefined,
      startDate: "",
      endDate: "",
      reason: "",
      attachmentUrl: "",
    },
  });

  const selectedEmployeeId = form.watch("employeeId");
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);
  const selectedLeaveType = form.watch("leaveType");

  const { data: leaveBalances } = useLeaveBalances(
    selectedEmployee?.userId || selectedEmployee?.user?.id || "",
    activeAcademicYear?.id,
  );

  const annualBalance = leaveBalances?.find((b) => b.leaveType === "ANNUAL");

  const startDate = form.watch("startDate");
  const endDate = form.watch("endDate");
  const totalDays =
    startDate && endDate && new Date(endDate) >= new Date(startDate)
      ? differenceInDays(new Date(endDate), new Date(startDate)) + 1
      : 0;

  const onSubmit = async (data: LeaveRequestFormData) => {
    try {
      // The API contract is `type` + `staffId`; the form's own names
      // (`leaveType`, `employeeId`) must be mapped, not sent through as-is.
      await createLeaveRequest.mutateAsync({
        type: data.leaveType,
        staffId: data.employeeId,
        startDate: new Date(data.startDate).toISOString(),
        endDate: new Date(data.endDate).toISOString(),
        reason: data.reason,
      });
      toast.success("Pengajuan cuti berhasil dibuat");
      router.push("/hr");
    } catch (error) {
      toast.error("Gagal membuat pengajuan cuti");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ajukan Cuti</h1>
            <p className="text-muted-foreground">
              Buat pengajuan cuti untuk karyawan
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Data Pengajuan Cuti
                    </CardTitle>
                    <CardDescription>Isi form pengajuan cuti</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="employeeId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Karyawan</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih karyawan" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {employees.map((emp) => (
                                <SelectItem key={emp.id} value={emp.id}>
                                  {emp.fullName} - {emp.position}
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
                      name="leaveType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Jenis Cuti</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih jenis cuti" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {LEAVE_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {LEAVE_TYPE_LABELS[type]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tanggal Mulai</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="endDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tanggal Selesai</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Alasan Cuti</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Jelaskan alasan pengajuan cuti..."
                              className="min-h-[100px]"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>Minimal 10 karakter</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="attachmentUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lampiran (URL)</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="URL dokumen pendukung (opsional)"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Untuk cuti sakit, lampirkan surat keterangan dokter
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {selectedLeaveType === "ANNUAL" && annualBalance && (
                  <Card className="border-green-200 bg-green-50">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <span className="text-green-800 font-medium">
                          Sisa Cuti Tahunan:
                        </span>
                        <span className="text-2xl font-bold text-green-800">
                          {annualBalance.remainingDays} Hari
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="flex justify-end gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.back()}
                  >
                    Batal
                  </Button>
                  <Button type="submit" disabled={createLeaveRequest.isPending}>
                    {createLeaveRequest.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Ajukan Cuti
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </div>

          {/* Summary Card */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Ringkasan</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Total Hari</dt>
                    <dd className="text-2xl font-bold">{totalDays}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-blue-800 text-base">
                  <Info className="h-5 w-5" />
                  Informasi
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-blue-800">
                <ul className="list-disc list-inside space-y-1">
                  <li>Cuti tahunan maksimal 12 hari/tahun</li>
                  <li>
                    Cuti sakit lebih dari 2 hari wajib lampirkan surat dokter
                  </li>
                  <li>Pengajuan akan direview oleh atasan</li>
                  <li>Cuti tidak dapat diuangkan</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
