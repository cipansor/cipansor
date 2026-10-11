"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useEmployee,
  useUpdateEmployee,
  useDepartments,
  EMPLOYEE_TYPES,
  EMPLOYEE_TYPE_LABELS,
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
} from "@/hooks";
import { useUnits } from "@/hooks";
import {
  ArrowLeft,
  Save,
  Loader2,
  User,
  Briefcase,
  CreditCard,
  GraduationCap,
  AlertCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

const employeeSchema = z.object({
  nip: z.string().min(1, "NIP wajib diisi"),
  fullName: z.string().min(1, "Nama lengkap wajib diisi"),
  gender: z.enum(["MALE", "FEMALE"], {
    error: "Jenis kelamin wajib dipilih",
  }),
  birthPlace: z.string().optional(),
  birthDate: z.string().optional(),
  religion: z.string().optional(),
  maritalStatus: z.string().optional(),
  nik: z.string().optional(),
  email: z.string().email("Email tidak valid").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  unitId: z.string().min(1, "Unit wajib dipilih"),
  departmentId: z.string().optional(),
  position: z.string().min(1, "Jabatan wajib diisi"),
  employeeType: z.enum(["PERMANENT", "CONTRACT", "PART_TIME", "INTERN"]),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "RESIGNED", "RETIRED"]),
  joinDate: z.string().min(1, "Tanggal bergabung wajib diisi"),
  resignDate: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankAccountName: z.string().optional(),
  npwp: z.string().optional(),
  bpjsKesehatan: z.string().optional(),
  bpjsKetenagakerjaan: z.string().optional(),
  lastEducation: z.string().optional(),
  educationInstitution: z.string().optional(),
  educationMajor: z.string().optional(),
  graduationYear: z.string().optional(),
});

type EmployeeFormData = z.infer<typeof employeeSchema>;

export default function EditEmployeePage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.id as string;
  const [activeTab, setActiveTab] = useState("personal");

  const { data: employee, isLoading } = useEmployee(employeeId);
  const updateEmployee = useUpdateEmployee();

  const { data: units } = useUnits();
  const { data: departments } = useDepartments();

  const form = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      nip: "",
      fullName: "",
      gender: undefined,
      birthPlace: "",
      birthDate: "",
      religion: "",
      maritalStatus: "",
      nik: "",
      email: "",
      phone: "",
      address: "",
      unitId: "",
      departmentId: "",
      position: "",
      employeeType: undefined,
      status: "ACTIVE",
      joinDate: "",
      resignDate: "",
      bankName: "",
      bankAccountNumber: "",
      bankAccountName: "",
      npwp: "",
      bpjsKesehatan: "",
      bpjsKetenagakerjaan: "",
      lastEducation: "",
      educationInstitution: "",
      educationMajor: "",
      graduationYear: "",
    },
  });

  useEffect(() => {
    if (employee) {
      form.reset({
        nip: employee.nip,
        fullName: employee.fullName,
        gender: employee.gender,
        birthPlace: employee.birthPlace ?? "",
        birthDate: employee.birthDate
          ? new Date(employee.birthDate).toISOString().split("T")[0]
          : "",
        religion: employee.religion ?? "",
        maritalStatus: employee.maritalStatus ?? "",
        nik: employee.nik ?? "",
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        address: employee.address ?? "",
        unitId: employee.unitId,
        departmentId: employee.departmentId ?? "",
        position: employee.position,
        employeeType: employee.employeeType,
        status: employee.status,
        joinDate: employee.joinDate
          ? new Date(employee.joinDate).toISOString().split("T")[0]
          : "",
        resignDate: employee.resignDate
          ? new Date(employee.resignDate).toISOString().split("T")[0]
          : "",
        bankName: employee.bankName ?? "",
        bankAccountNumber: employee.bankAccountNumber ?? "",
        bankAccountName: employee.bankAccountName ?? "",
        npwp: employee.npwp ?? "",
        bpjsKesehatan: employee.bpjsKesehatan ?? "",
        bpjsKetenagakerjaan: employee.bpjsKetenagakerjaan ?? "",
        lastEducation: employee.lastEducation ?? "",
        educationInstitution: employee.educationInstitution ?? "",
        educationMajor: employee.educationMajor ?? "",
        graduationYear: employee.graduationYear?.toString() ?? "",
      });
    }
  }, [employee, form]);

  const onSubmit = async (data: EmployeeFormData) => {
    try {
      await updateEmployee.mutateAsync({
        id: employeeId,
        data: {
          ...data,
          birthDate: data.birthDate || undefined,
          resignDate: data.resignDate || undefined,
          graduationYear: data.graduationYear
            ? parseInt(data.graduationYear)
            : undefined,
        },
      });
      toast.success("Data karyawan berhasil diperbarui");
      router.push(`/hr/employees/${employeeId}`);
    } catch (error) {
      toast.error("Gagal memperbarui data karyawan");
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </MainLayout>
    );
  }

  if (!employee) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">Karyawan tidak ditemukan</p>
          <Button onClick={() => router.push("/hr")}>Kembali ke Daftar</Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Karyawan</h1>
            <p className="text-muted-foreground">
              Perbarui data {employee.fullName}
            </p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="personal">
                  <User className="mr-2 h-4 w-4" />
                  Data Pribadi
                </TabsTrigger>
                <TabsTrigger value="employment">
                  <Briefcase className="mr-2 h-4 w-4" />
                  Kepegawaian
                </TabsTrigger>
                <TabsTrigger value="bank">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Bank & Pajak
                </TabsTrigger>
                <TabsTrigger value="education">
                  <GraduationCap className="mr-2 h-4 w-4" />
                  Pendidikan
                </TabsTrigger>
              </TabsList>

              {/* Personal Info Tab */}
              <TabsContent value="personal" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Informasi Pribadi</CardTitle>
                    <CardDescription>Data pribadi karyawan</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="nip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>NIP *</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="nik"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>NIK</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nama Lengkap *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="gender"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Jenis Kelamin *</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="MALE">Laki-laki</SelectItem>
                                <SelectItem value="FEMALE">
                                  Perempuan
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="religion"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Agama</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Islam">Islam</SelectItem>
                                <SelectItem value="Kristen">Kristen</SelectItem>
                                <SelectItem value="Katolik">Katolik</SelectItem>
                                <SelectItem value="Hindu">Hindu</SelectItem>
                                <SelectItem value="Buddha">Buddha</SelectItem>
                                <SelectItem value="Konghucu">
                                  Konghucu
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="birthPlace"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tempat Lahir</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="birthDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tanggal Lahir</FormLabel>
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
                      name="maritalStatus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status Pernikahan</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Belum Menikah">
                                Belum Menikah
                              </SelectItem>
                              <SelectItem value="Menikah">Menikah</SelectItem>
                              <SelectItem value="Cerai Hidup">
                                Cerai Hidup
                              </SelectItem>
                              <SelectItem value="Cerai Mati">
                                Cerai Mati
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Kontak</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input type="email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>No. Telepon</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Alamat</FormLabel>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Employment Tab */}
              <TabsContent value="employment" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Data Kepegawaian</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="unitId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unit *</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {units?.map((unit) => (
                                  <SelectItem key={unit.id} value={unit.id}>
                                    {unit.name}
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
                        name="departmentId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Departemen</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="">Tidak ada</SelectItem>
                                {departments?.map((dept) => (
                                  <SelectItem key={dept.id} value={dept.id}>
                                    {dept.name}
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
                      name="position"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Jabatan *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="employeeType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tipe Karyawan *</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EMPLOYEE_TYPES.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {EMPLOYEE_TYPE_LABELS[type]}
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
                        name="status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Status *</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EMPLOYEE_STATUSES.map((status) => (
                                  <SelectItem key={status} value={status}>
                                    {EMPLOYEE_STATUS_LABELS[status]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="joinDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tanggal Bergabung *</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="resignDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tanggal Resign</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Bank Tab */}
              <TabsContent value="bank" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Informasi Bank</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="bankName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nama Bank</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="">Tidak ada</SelectItem>
                              <SelectItem value="BCA">BCA</SelectItem>
                              <SelectItem value="BNI">BNI</SelectItem>
                              <SelectItem value="BRI">BRI</SelectItem>
                              <SelectItem value="Mandiri">Mandiri</SelectItem>
                              <SelectItem value="BSI">BSI</SelectItem>
                              <SelectItem value="BTN">BTN</SelectItem>
                              <SelectItem value="CIMB Niaga">
                                CIMB Niaga
                              </SelectItem>
                              <SelectItem value="Lainnya">Lainnya</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="bankAccountNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nomor Rekening</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="bankAccountName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Atas Nama</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Pajak & BPJS</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="npwp"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>NPWP</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="bpjsKesehatan"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>No. BPJS Kesehatan</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="bpjsKetenagakerjaan"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>No. BPJS Ketenagakerjaan</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Education Tab */}
              <TabsContent value="education" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Pendidikan Terakhir</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="lastEducation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Jenjang Pendidikan</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="">Tidak ada</SelectItem>
                              <SelectItem value="SD">SD/Sederajat</SelectItem>
                              <SelectItem value="SMP">SMP/Sederajat</SelectItem>
                              <SelectItem value="SMA">SMA/Sederajat</SelectItem>
                              <SelectItem value="D1">D1</SelectItem>
                              <SelectItem value="D2">D2</SelectItem>
                              <SelectItem value="D3">D3</SelectItem>
                              <SelectItem value="D4">D4</SelectItem>
                              <SelectItem value="S1">S1</SelectItem>
                              <SelectItem value="S2">S2</SelectItem>
                              <SelectItem value="S3">S3</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="educationInstitution"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nama Institusi</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="educationMajor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Jurusan</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="graduationYear"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tahun Lulus</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Submit Buttons */}
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Batal
              </Button>
              <Button type="submit" disabled={updateEmployee.isPending}>
                {updateEmployee.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Simpan Perubahan
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
