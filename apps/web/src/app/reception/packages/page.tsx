"use client";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import {
  usePackages,
  useCreatePackage,
  useUpdatePackage,
  StudentPackage,
} from "@/hooks/use-reception";
import { useStudents } from "@/hooks/use-students";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { useForm, Controller } from "react-hook-form";
import { format } from "date-fns";
import { toast } from "sonner";
import { CreateStudentPackageInput, PackageStatus } from "@cipansor/shared";
import { Loader2, Plus, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { STUDENT_STATUS } from "@cipansor/shared";

export default function PackagePage() {
  const [date, setDate] = useState<Date>(new Date());
  const { data: packages, isLoading } = usePackages({
    date: date.toISOString(),
  });
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Paket Santri</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={format(date, "yyyy-MM-dd")}
            onChange={(e) => setDate(new Date(e.target.value))}
            className="w-auto"
          />
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Terima Paket
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Catat Paket Masuk</DialogTitle>
              </DialogHeader>
              <PackageForm onSuccess={() => setIsOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu</TableHead>
              <TableHead>Penerima (Santri)</TableHead>
              <TableHead>Pengirim</TableHead>
              <TableHead>Ekspedisi</TableHead>
              <TableHead>Isi Paket</TableHead>
              <TableHead>Lokasi Simpan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center h-24">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : packages?.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center h-24 text-muted-foreground"
                >
                  Belum ada paket hari ini
                </TableCell>
              </TableRow>
            ) : (
              packages?.map((pkg) => <PackageRow key={pkg.id} pkg={pkg} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PackageForm({ onSuccess }: { onSuccess: () => void }) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateStudentPackageInput>();
  const createPackage = useCreatePackage();
  const { data: studentsData } = useStudents({
    page: 1,
    limit: 100,
    status: STUDENT_STATUS.ACTIVE,
  });

  const studentOptions =
    studentsData?.data?.map((s) => ({
      value: s.id,
      label: `${s.name} (${s.nis})`,
    })) || [];

  const onSubmit = async (data: CreateStudentPackageInput) => {
    try {
      await createPackage.mutateAsync(data);
      toast.success("Paket berhasil dicatat");
      onSuccess();
    } catch (_error) {
      // Handled
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-2">
        <Label>Santri Penerima</Label>
        <Controller
          control={control}
          name="studentId"
          rules={{ required: true }}
          render={({ field }) => (
            <SearchableSelect
              options={studentOptions}
              value={field.value}
              onValueChange={field.onChange}
              placeholder="Pilih santri..."
            />
          )}
        />
        {errors.studentId && (
          <span className="text-xs text-red-500">Wajib dipilih</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="senderName">Pengirim</Label>
          <Input
            id="senderName"
            {...register("senderName", { required: true })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="expedition">Ekspedisi (JNE, dll)</Label>
          <Input
            id="expedition"
            {...register("expedition", { required: true })}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="content">Isi Paket (Deskripsi)</Label>
        <Textarea id="content" {...register("content", { required: true })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="storageLocation">Lokasi Simpan</Label>
        <Input
          id="storageLocation"
          placeholder="Rak A1"
          {...register("storageLocation")}
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={createPackage.isPending}
      >
        {createPackage.isPending && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        )}
        Simpan
      </Button>
    </form>
  );
}

function PackageRow({ pkg }: { pkg: StudentPackage }) {
  const updatePackage = useUpdatePackage();

  const handlePickup = async () => {
    try {
      await updatePackage.mutateAsync({
        id: pkg.id,
        data: {
          status: PackageStatus.PICKED_UP,
          pickedUpAt: new Date(),
        },
      });
      toast.success("Paket telah diambil");
    } catch (_error) {
      // Handled
    }
  };

  const getStatusBadge = (status: PackageStatus) => {
    switch (status) {
      case "RECEIVED":
        return <Badge variant="secondary">Diterima Resepsionis</Badge>;
      case "NOTIFIED":
        return <Badge className="bg-blue-500">Notifikasi Terkirim</Badge>;
      case "PICKED_UP":
        return <Badge variant="outline">Sudah Diambil</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <TableRow>
      <TableCell>{safeFormat(new Date(pkg.createdAt), "HH:mm")}</TableCell>
      <TableCell>
        <div className="font-medium">{pkg.student?.name}</div>
        <div className="text-xs text-muted-foreground">{pkg.student?.nis}</div>
      </TableCell>
      <TableCell>{pkg.senderName}</TableCell>
      <TableCell>{pkg.expedition}</TableCell>
      <TableCell>{pkg.content}</TableCell>
      <TableCell>
        {pkg.storageLocation || (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>{getStatusBadge(pkg.status)}</TableCell>
      <TableCell>
        {pkg.status !== "PICKED_UP" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePickup}
            title="Tandai Diambil"
          >
            <PackageCheck className="h-4 w-4 mr-2" /> Ambil
          </Button>
        )}
        {pkg.status === "PICKED_UP" && (
          <span className="text-xs text-muted-foreground">
            {pkg.pickedUpAt
              ? safeFormat(new Date(pkg.pickedUpAt), "dd/MM HH:mm")
              : "-"}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
