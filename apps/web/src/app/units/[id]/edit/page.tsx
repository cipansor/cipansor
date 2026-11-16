"use client";

import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import {
  NPSN_MESSAGE,
  NPSN_PATTERN,
  unitOfficialIdentityFields,
} from "@cipansor/shared";

import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useUnit,
  useUpdateUnit,
  UNIT_TYPES,
  UNIT_TYPE_VALUES,
  type Unit,
} from "@/hooks/use-units";
import { getErrorMessage } from "@/lib/api-error";
import { getPrimaryRoleCode } from "@/lib/rbac";
import { useAuthStore } from "@/stores/auth";

const unitSchema = z.object({
  name: z.string().trim().min(3, "Nama unit minimal 3 karakter"),
  // Derived from UNIT_TYPES so the form can never accept a narrower set than
  // the database holds — this literal list had fallen two values behind.
  type: z.enum(UNIT_TYPE_VALUES, {
    error: "Tipe unit wajib dipilih",
  }),
  address: z.string().trim().min(5, "Alamat minimal 5 karakter"),
  phone: z.string().trim(),
  email: z.string().trim().email("Email tidak valid").or(z.literal("")),
  npsn: z.string().trim().regex(NPSN_PATTERN, NPSN_MESSAGE).or(z.literal("")),
  officialName: unitOfficialIdentityFields.officialName.or(z.literal("")),
  operatingPermitNumber: unitOfficialIdentityFields.operatingPermitNumber.or(
    z.literal(""),
  ),
  operatingPermitDate: unitOfficialIdentityFields.operatingPermitDate.or(
    z.literal(""),
  ),
});

type UnitFormData = z.infer<typeof unitSchema>;

export default function EditUnitPage() {
  const params = useParams();
  const unitId = params.id as string;
  const { data: unit, isLoading: unitLoading } = useUnit(unitId);

  if (unitLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  if (!unit) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-96 space-y-4">
          <p className="text-muted-foreground">Unit tidak ditemukan</p>
          <Button asChild>
            <Link href="/units">Kembali ke Daftar Unit</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  // Built once the unit is here, with it as the defaults: filling the form
  // with reset() after mount left the Tipe Unit select empty, and the form
  // then refused to save ("Tipe unit wajib dipilih") —
  // lessons/select-empty-value-sentinel.
  return <EditUnitForm key={unit.id} unit={unit} />;
}

function EditUnitForm({ unit }: { unit: Unit }) {
  const router = useRouter();
  const unitId = unit.id;
  const updateUnit = useUpdateUnit();
  // The type decides where the unit appears on the public site; only the
  // Super Admin changes it (the API refuses anyone else).
  const mayChangeType =
    getPrimaryRoleCode(useAuthStore((s) => s.user)) === "SUPER_ADMIN";

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UnitFormData>({
    resolver: zodResolver(unitSchema),
    defaultValues: {
      name: unit.name,
      type: unit.type,
      address: unit.address || "",
      phone: unit.phone || "",
      email: unit.email || "",
      npsn: unit.npsn || "",
      officialName: unit.officialName || "",
      operatingPermitNumber: unit.operatingPermitNumber || "",
      operatingPermitDate: unit.operatingPermitDate?.slice(0, 10) || "",
    },
  });

  const onSubmit = async (data: UnitFormData) => {
    try {
      await updateUnit.mutateAsync({
        id: unitId,
        data: {
          name: data.name,
          ...(mayChangeType ? { type: data.type } : {}),
          address: data.address,
          // An emptied field is cleared, not left as it was.
          phone: data.phone || null,
          email: data.email || null,
          npsn: data.npsn || null,
          officialName: data.officialName || null,
          operatingPermitNumber: data.operatingPermitNumber || null,
          operatingPermitDate: data.operatingPermitDate || null,
        },
      });
      toast.success("Unit berhasil diperbarui");
      router.push(`/units/${unitId}`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error) || "Gagal memperbarui unit");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/units/${unitId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Edit Unit</h1>
            <p className="text-muted-foreground">
              Perbarui data unit {unit.name}
            </p>
          </div>
        </div>

        {/* noValidate: Zod is the single source of validation (AGENTS.md rule
            4). Without it WebKit's native date input, once cleared, latches a
            `badInput` state that silently blocks the submit — the Save button
            looks enabled but the click does nothing (#852). */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Informasi Dasar</CardTitle>
                <CardDescription>Data utama unit pendidikan</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Unit *</Label>
                  <Input
                    id="name"
                    placeholder="Contoh: SMP IT Cipansor"
                    {...register("name")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Nama pendek yang tampil di menu dan layar portal.
                  </p>
                  {errors.name && (
                    <p className="text-sm text-destructive">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Tipe Unit *</Label>
                  <Select
                    value={watch("type")}
                    onValueChange={(value) =>
                      setValue("type", value as UnitFormData["type"])
                    }
                    disabled={!mayChangeType}
                  >
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Pilih tipe unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!mayChangeType && (
                    <p className="text-xs text-muted-foreground">
                      Hanya Super Admin yang dapat mengubah jenis unit.
                    </p>
                  )}
                  {errors.type && (
                    <p className="text-sm text-destructive">
                      {errors.type.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Kontak & Lokasi</CardTitle>
                <CardDescription>Informasi kontak unit</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="address">Alamat *</Label>
                  <Textarea
                    id="address"
                    placeholder="Alamat lengkap unit"
                    rows={3}
                    {...register("address")}
                  />
                  {errors.address && (
                    <p className="text-sm text-destructive">
                      {errors.address.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Telepon</Label>
                  <Input
                    id="phone"
                    placeholder="0265-1234567"
                    {...register("phone")}
                  />
                  {errors.phone && (
                    <p className="text-sm text-destructive">
                      {errors.phone.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="unit@cipansor.or.id"
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className="text-sm text-destructive">
                      {errors.email.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Identitas Resmi</CardTitle>
                <CardDescription>
                  Sesuai izin operasional dan Data Referensi Kemendikdasmen.
                  Dicetak di kop surat, rapor, sertifikat, kartu santri, dan
                  ekspor Dapodik; menu dan layar portal tetap memakai Nama Unit.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="officialName">Nama Resmi</Label>
                  <Input
                    id="officialName"
                    placeholder="Contoh: SMP IT Pesantren Cipansor"
                    {...register("officialName")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Kosongkan bila sama dengan Nama Unit; dokumen lalu memakai
                    Nama Unit.
                  </p>
                  {errors.officialName && (
                    <p className="text-sm text-destructive">
                      {errors.officialName.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="npsn">NPSN</Label>
                  <Input
                    id="npsn"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="8 angka, dari Dapodik"
                    {...register("npsn")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Tampil di situs publik bersama akreditasi, dan dipakai
                    ekspor EMIS/Dapodik serta SKHUN. Kosongkan bila unit ini
                    tidak memilikinya.
                  </p>
                  {errors.npsn && (
                    <p className="text-sm text-destructive">
                      {errors.npsn.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="operatingPermitNumber">
                    Nomor Izin Operasional
                  </Label>
                  <Input
                    id="operatingPermitNumber"
                    placeholder="Contoh: 503/0671/Kep.07/DPMPTSP/2019"
                    {...register("operatingPermitNumber")}
                  />
                  {errors.operatingPermitNumber && (
                    <p className="text-sm text-destructive">
                      {errors.operatingPermitNumber.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="operatingPermitDate">
                    Tanggal Izin Operasional
                  </Label>
                  <Input
                    id="operatingPermitDate"
                    type="date"
                    {...register("operatingPermitDate")}
                  />
                  {errors.operatingPermitDate && (
                    <p className="text-sm text-destructive">
                      {errors.operatingPermitDate.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end gap-4 mt-6">
            <Button type="button" variant="outline" asChild>
              <Link href={`/units/${unitId}`}>Batal</Link>
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || updateUnit.isPending}
            >
              {isSubmitting || updateUnit.isPending
                ? "Menyimpan..."
                : "Simpan Perubahan"}
            </Button>
          </div>
        </form>
      </div>
    </MainLayout>
  );
}
