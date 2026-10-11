"use client";
import { useState, useEffect } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  useAlumniDetail,
  useUpdateAlumni,
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
} from "@/hooks";
import { useUnits } from "@/hooks";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

const alumniSchema = z.object({
  fullName: z.string().min(1, "Nama lengkap wajib diisi"),
  gender: z.enum(["MALE", "FEMALE"], {
    error: "Jenis kelamin wajib dipilih",
  }),
  birthPlace: z.string().min(1, "Tempat lahir wajib diisi"),
  birthDate: z.string().min(1, "Tanggal lahir wajib diisi"),
  phone: z.string().min(1, "Nomor telepon wajib diisi"),
  email: z.string().email("Email tidak valid"),
  address: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),

  graduationYear: z.number().min(1900).max(new Date().getFullYear()),
  unitId: z.string().min(1, "Unit asal wajib dipilih"),

  currentEducation: z.string().optional(),
  educationInstitution: z.string().optional(),
  educationMajor: z.string().optional(),
  educationYear: z.string().optional(),

  employmentStatus: z.string().optional(),
  companyName: z.string().optional(),
  position: z.string().optional(),
  industry: z.string().optional(),
  workCity: z.string().optional(),

  linkedinUrl: z.string().url().optional().or(z.literal("")),
  instagramUrl: z.string().optional(),
  facebookUrl: z.string().optional(),

  bio: z.string().optional(),
});

type AlumniFormData = z.infer<typeof alumniSchema>;

export default function EditAlumniPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [step, setStep] = useState(1);
  const totalSteps = 3;

  const { data: alumni, isLoading } = useAlumniDetail(id);
  const { data: units } = useUnits();
  const updateMutation = useUpdateAlumni();

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 50 }, (_, i) => currentYear - i);

  const form = useForm<AlumniFormData>({
    resolver: zodResolver(alumniSchema),
    defaultValues: {
      fullName: "",
      gender: undefined,
      birthPlace: "",
      birthDate: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      province: "",
      graduationYear: currentYear,
      unitId: "",
      currentEducation: "",
      educationInstitution: "",
      educationMajor: "",
      educationYear: "",
      employmentStatus: "",
      companyName: "",
      position: "",
      industry: "",
      workCity: "",
      linkedinUrl: "",
      instagramUrl: "",
      facebookUrl: "",
      bio: "",
    },
  });

  useEffect(() => {
    if (alumni) {
      // Every field is coerced to a string/undefined: the API returns `null`
      // for unset columns, and React warns (and switches the input from
      // controlled to uncontrolled) when a form control receives `null`.
      form.reset({
        fullName: alumni.fullName ?? "",
        gender: alumni.gender ?? undefined,
        birthPlace: alumni.birthPlace ?? "",
        birthDate: alumni.birthDate
          ? safeFormat(new Date(alumni.birthDate), "yyyy-MM-dd")
          : "",
        phone: alumni.phone || "",
        email: alumni.email || "",
        address: alumni.address || "",
        city: alumni.city || "",
        province: alumni.province || "",
        graduationYear: alumni.graduationYear ?? currentYear,
        unitId: alumni.unitId || alumni.unit?.id || "",
        currentEducation: alumni.currentEducation || "",
        educationInstitution: alumni.educationInstitution || "",
        educationMajor: alumni.educationMajor || "",
        educationYear: alumni.educationYear ? String(alumni.educationYear) : "",
        employmentStatus: alumni.employmentStatus || "",
        companyName: alumni.companyName || alumni.currentCompany || "",
        position: alumni.position || alumni.currentOccupation || "",
        industry: alumni.industry || "",
        workCity: alumni.workCity || alumni.currentCity || "",
        linkedinUrl: alumni.linkedinUrl || "",
        instagramUrl: alumni.instagramUrl || "",
        facebookUrl: alumni.facebookUrl || "",
        bio: alumni.bio || "",
      });
    }
  }, [alumni, form]);

  const onSubmit = async (data: AlumniFormData) => {
    try {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          formData.append(key, String(value));
        }
      });

      await updateMutation.mutateAsync({ id, data: formData });
      toast.success("Data alumni berhasil diperbarui");
      router.push(`/alumni/${id}`);
    } catch {
      toast.error("Gagal memperbarui data alumni");
    }
  };

  const nextStep = async () => {
    const fieldsToValidate = getFieldsForStep(step);
    const isValid = await form.trigger(
      fieldsToValidate as (keyof AlumniFormData)[],
    );
    if (isValid) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    setStep(step - 1);
  };

  const getFieldsForStep = (stepNumber: number): string[] => {
    switch (stepNumber) {
      case 1:
        return [
          "fullName",
          "gender",
          "birthPlace",
          "birthDate",
          "phone",
          "email",
          "graduationYear",
          "unitId",
        ];
      case 2:
        return [];
      case 3:
        return [];
      default:
        return [];
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </MainLayout>
    );
  }

  if (!alumni) {
    return (
      <MainLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Data alumni tidak ditemukan</p>
          <Button variant="link" asChild>
            <Link href="/alumni">Kembali ke daftar</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/alumni/${id}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Edit Data Alumni</h1>
            <p className="text-muted-foreground">
              {alumni.fullName} · Langkah {step} dari {totalSteps}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-2 flex-1 rounded-full ${
                i + 1 <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Step 1: Data Pribadi */}
            {step === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Data Pribadi</CardTitle>
                  <CardDescription>Informasi dasar alumni</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nama Lengkap *</FormLabel>
                        <FormControl>
                          <Input placeholder="Nama lengkap" {...field} />
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
                                <SelectValue placeholder="Pilih jenis kelamin" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="MALE">Laki-laki</SelectItem>
                              <SelectItem value="FEMALE">Perempuan</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="birthDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tanggal Lahir *</FormLabel>
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
                    name="birthPlace"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tempat Lahir *</FormLabel>
                        <FormControl>
                          <Input placeholder="Kota tempat lahir" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>No. Telepon *</FormLabel>
                          <FormControl>
                            <Input placeholder="08xxxxxxxxxx" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email *</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="email@example.com"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="graduationYear"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tahun Lulus *</FormLabel>
                          <Select
                            onValueChange={(v) => field.onChange(parseInt(v))}
                            value={String(field.value)}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih tahun" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {years.map((year) => (
                                <SelectItem key={year} value={String(year)}>
                                  {year}
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
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unit Asal *</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih unit" />
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
                  </div>

                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Alamat</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Alamat lengkap" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kota</FormLabel>
                          <FormControl>
                            <Input placeholder="Kota domisili" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="province"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Provinsi</FormLabel>
                          <FormControl>
                            <Input placeholder="Provinsi" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 2: Karir & Pendidikan */}
            {step === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Karir & Pendidikan</CardTitle>
                  <CardDescription>
                    Informasi pekerjaan dan pendidikan lanjutan
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Pekerjaan */}
                  <div className="space-y-4">
                    <h3 className="font-medium">Pekerjaan</h3>
                    <FormField
                      control={form.control}
                      name="employmentStatus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status Pekerjaan</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {EMPLOYMENT_STATUSES.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {EMPLOYMENT_STATUS_LABELS[status]}
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
                        name="companyName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nama Perusahaan</FormLabel>
                            <FormControl>
                              <Input placeholder="PT Example" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="position"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Jabatan</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Software Engineer"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="industry"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Industri</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Teknologi, Pendidikan, dll"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="workCity"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Kota Kerja</FormLabel>
                            <FormControl>
                              <Input placeholder="Jakarta" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Pendidikan */}
                  <div className="space-y-4">
                    <h3 className="font-medium">Pendidikan Lanjutan</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="currentEducation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Jenjang</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Pilih jenjang" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {EDUCATION_LEVELS.map((level) => (
                                  <SelectItem key={level} value={level}>
                                    {EDUCATION_LEVEL_LABELS[level]}
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
                        name="educationYear"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tahun Masuk</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="2020"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="educationInstitution"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Institusi</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Universitas Indonesia"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="educationMajor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Jurusan</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Teknik Informatika"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Step 3: Media Sosial & Bio */}
            {step === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle>Media Sosial & Bio</CardTitle>
                  <CardDescription>
                    Informasi tambahan dan media sosial
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="linkedinUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>LinkedIn URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://linkedin.com/in/username"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="instagramUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Instagram</FormLabel>
                        <FormControl>
                          <Input placeholder="@username" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="facebookUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Facebook URL</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://facebook.com/username"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bio"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bio</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Ceritakan tentang diri Anda..."
                            rows={4}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={prevStep}
                disabled={step === 1}
              >
                Sebelumnya
              </Button>
              {step < totalSteps ? (
                <Button type="button" onClick={nextStep}>
                  Selanjutnya
                </Button>
              ) : (
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  <Save className="mr-2 h-4 w-4" />
                  Simpan Perubahan
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </MainLayout>
  );
}
