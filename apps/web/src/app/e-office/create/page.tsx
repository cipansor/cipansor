"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { getPrimaryRoleCode } from "@/lib/rbac";
import { useCorrespondence } from "@/hooks/use-correspondence";
import { useCorrespondenceParticipants } from "@/hooks/use-correspondence";
import { useUnits } from "@/hooks/use-units";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
// import { MultiSelect } from '@/components/ui/multi-select';
import {
  LetterDirection,
  LetterUrgency,
  LetterNature,
  LetterStatus,
  LetterType,
  LETTER_TYPE_LABELS,
  LETTER_NATURE_LABELS,
  LETTER_URGENCY_LABELS,
  naturesForType,
  renderTemplateDraft,
  remainingPlaceholders,
} from "@cipansor/shared";
import { TembusanEditor } from "@/components/e-office/tembusan-editor";
import { toast } from "sonner";
import { api } from "@/lib/api";
import React from "react";
import { Upload } from "lucide-react";

const letterSchema = z.object({
  unitId: z.string().optional(),
  direction: z.nativeEnum(LetterDirection),
  type: z.nativeEnum(LetterType),
  subject: z.string().min(1, "Perihal wajib diisi"),
  date: z.string(),
  urgency: z.nativeEnum(LetterUrgency),
  nature: z.nativeEnum(LetterNature),
  senderName: z.string().optional(),
  senderInstance: z.string().optional(),
  recipientName: z.string().optional(),
  recipientInstance: z.string().optional(),
  content: z.string().optional(),
  fileUrl: z.string().optional(),
  reviewerIds: z.array(z.string()).optional(),
  recipientIds: z.array(z.string()).optional(),
  ccRecipients: z
    .array(
      z.object({
        userId: z.string().optional(),
        externalName: z.string().optional(),
      }),
    )
    .optional(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        fileUrl: z.string(),
        mimeType: z.string().optional(),
        sizeBytes: z.number().optional(),
      }),
    )
    .optional(),
});

function CreateLetterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  /**
   * The direction the caller asked for.
   *
   * The e-office dashboard has separate tiles for "Catat Surat Masuk" and
   * "Buat Surat Keluar" and sends `?direction=incoming` / `?direction=outgoing`
   * with each. The form ignored the parameter entirely and always opened as an
   * outgoing letter — so "Catat Surat Masuk" opened a form for writing one.
   */
  const requestedDirection =
    searchParams.get("direction")?.toUpperCase() === "INCOMING"
      ? LetterDirection.INCOMING
      : LetterDirection.OUTGOING;
  const { data: units = [] } = useUnits();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadingAttachment, setUploadingAttachment] = React.useState(false);
  const [submitMode, setSubmitMode] = React.useState<"DRAFT" | "SUBMIT">(
    "DRAFT",
  );

  const form = useForm<z.infer<typeof letterSchema>>({
    resolver: zodResolver(letterSchema),
    defaultValues: {
      unitId: user?.unitId || "",
      direction: requestedDirection,
      type: LetterType.SURAT_DINAS,
      date: new Date().toISOString().split("T")[0],
      urgency: LetterUrgency.NORMAL,
      nature: LetterNature.PUBLIC,
      reviewerIds: [],
      recipientIds: [],
      ccRecipients: [],
      attachments: [],
    },
  });

  const selectedUnitId = form.watch("unitId") || user?.unitId;
  const { createLetter } = useCorrespondence(selectedUnitId);
  const { data: participantsData } = useCorrespondenceParticipants({
    search: searchQuery || undefined,
    unitId: selectedUnitId,
    limit: 100,
  });

  const staffOptions =
    participantsData?.data.map((u) => ({
      label: u.nip ? `${u.name} (${u.nip})` : u.name,
      value: u.id,
    })) || [];

  const direction = form.watch("direction");
  const letterType = form.watch("type");
  // The natures a type may carry come from the shared rule the server enforces,
  // so the form can never offer a choice the API will reject. When the type
  // changes to one that disallows the current nature (e.g. switching to Surat
  // Keputusan while "Rahasia" is selected), snap back to Biasa rather than
  // submit a pair the server will refuse.
  const allowedNatures = naturesForType(letterType ?? LetterType.SURAT_DINAS);
  React.useEffect(() => {
    const current = form.getValues("nature");
    if (!allowedNatures.includes(current)) {
      form.setValue("nature", LetterNature.PUBLIC);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letterType]);

  // Recomputed from the live field so it clears as the drafter fills things in.
  const contentValue = form.watch("content");
  const leftoverPlaceholders = React.useMemo(
    () => remainingPlaceholders(contentValue ?? ""),
    [contentValue],
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (response.data.success) {
        form.setValue("fileUrl", response.data.data.url);
        toast.success("File berhasil diupload");
      }
    } catch (error) {
      toast.error("Gagal upload file");
    } finally {
      setUploading(false);
    }
  };

  /**
   * Menambahkan satu lampiran.
   *
   * Berkasnya diunggah lebih dulu dan yang disimpan bersama surat hanyalah
   * rujukannya — jalur yang sama dengan berkas naskah di atas. Nama aslinya
   * ikut disimpan: "Daftar hadir.pdf" adalah yang dicari pengarsip, bukan nama
   * acak yang diberikan penyimpanan.
   */
  const handleAttachmentUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAttachment(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (response.data.success) {
        form.setValue("attachments", [
          ...(form.getValues("attachments") || []),
          {
            name: file.name,
            fileUrl: response.data.data.url,
            mimeType: file.type || undefined,
            sizeBytes: file.size,
          },
        ]);
        toast.success(`Lampiran "${file.name}" ditambahkan`);
      }
    } catch {
      toast.error("Gagal mengunggah lampiran");
    } finally {
      setUploadingAttachment(false);
      // Supaya berkas dengan nama yang sama dapat dipilih lagi setelah dihapus.
      e.target.value = "";
    }
  };

  async function onSubmit(values: z.infer<typeof letterSchema>) {
    const effectiveUnitId = values.unitId || user?.unitId;
    if (!effectiveUnitId) {
      toast.error("Unit ID wajib dipilih");
      return;
    }

    const targetStatus =
      submitMode === "SUBMIT"
        ? LetterStatus.PENDING_REVIEW
        : LetterStatus.DRAFT;

    if (
      submitMode === "SUBMIT" &&
      values.direction === LetterDirection.OUTGOING &&
      (!values.reviewerIds || values.reviewerIds.length === 0)
    ) {
      toast.error("Pemeriksa pertama wajib dipilih saat mengajukan review.");
      return;
    }

    try {
      await createLetter.mutateAsync({
        ...values,
        unitId: effectiveUnitId,
        status: targetStatus,
      });
      toast.success(
        targetStatus === LetterStatus.PENDING_REVIEW
          ? "Surat berhasil diajukan untuk ditinjau"
          : "Draft surat berhasil disimpan",
      );
      router.push("/e-office/inbox");
    } catch (error) {
      toast.error("Gagal memproses surat");
      console.error(error);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Buat Surat Baru</h1>
        <Button variant="outline" onClick={() => router.back()}>
          Batal
        </Button>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Dasar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* B5: Display unit selector ONLY when user is authorized to issue cross-unit letters */}
              {user &&
                (getPrimaryRoleCode(user) === "YAYASAN_KETUA" ||
                  getPrimaryRoleCode(user) === "YAYASAN_SEKRETARIS" ||
                  getPrimaryRoleCode(user) === "SUPER_ADMIN" ||
                  !user.unitId) && (
                  <FormField
                    control={form.control}
                    name="unitId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unit Penerbit / Pembuat Surat</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || user?.unitId || ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih unit penerbit..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {units.map((u) => (
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
                )}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="direction"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Arah Surat</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih arah surat" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={LetterDirection.INCOMING}>
                            Surat Masuk (diterima dari pihak lain)
                          </SelectItem>
                          <SelectItem value={LetterDirection.OUTGOING}>
                            Surat Keluar (diterbitkan yayasan)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* The real jenis naskah — what the document is, which decides
                    its numbering book and which sifat it may carry. Previously
                    absent, so an SK and an ordinary letter were the same thing
                    to the system. */}
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Jenis Naskah</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih jenis naskah" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.values(LetterType).map((t) => (
                            <SelectItem key={t} value={t}>
                              {LETTER_TYPE_LABELS[t]}
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
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perihal</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Contoh: Undangan Rapat Wali Murid"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="urgency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Urgensi</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {[
                            LetterUrgency.URGENT,
                            LetterUrgency.IMMEDIATE,
                            LetterUrgency.NORMAL,
                          ].map((u) => (
                            <SelectItem key={u} value={u}>
                              {LETTER_URGENCY_LABELS[u]}
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
                  name="nature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sifat</FormLabel>
                      {/* Options come from the selected type via the shared
                          rule, so "Terbatas" is now offered where it was
                          missing, and "Rahasia" disappears for a Surat
                          Keputusan — the same list the server enforces. */}
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {allowedNatures.map((n) => (
                            <SelectItem key={n} value={n}>
                              {LETTER_NATURE_LABELS[n]}
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
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tanggal Surat</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {direction === LetterDirection.OUTGOING && (
                <FormField
                  control={form.control}
                  name="reviewerIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pemeriksa / Peninjau Pertama</FormLabel>
                      <div className="space-y-2">
                        <Input
                          placeholder="Cari pejabat/staf..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="text-xs mb-1"
                        />
                        <Select
                          onValueChange={(val) => field.onChange([val])}
                          value={field.value?.[0] || ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih pemeriksa/atasan pertama..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {staffOptions.map((option: any) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <FormDescription>
                        Pilih pejabat/atasan pertama yang akan mengulas konsep
                        surat ini. Pemeriksa pertama dapat meneruskan secara
                        fleksibel ke pejabat berikutnya.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/*
                Tembusan — daftar yang bisa disusun, bukan daftar centang.

                Dua hal yang tidak bisa dilakukan daftar centang: memuat pihak
                yang tidak punya akun di sini (justru sebagian besar tembusan
                naskah dinas), dan menyimpan urutan — padahal tembusan tercetak
                sebagai daftar bernomor yang lazim menurun menurut kedudukan.
              */}
              {direction === LetterDirection.OUTGOING && (
                <FormField
                  control={form.control}
                  name="ccRecipients"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tembusan (opsional)</FormLabel>
                      <FormControl>
                        <TembusanEditor
                          value={field.value || []}
                          onChange={field.onChange}
                          participants={participantsData?.data ?? []}
                          search={searchQuery}
                          onSearchChange={setSearchQuery}
                        />
                      </FormControl>
                      <FormDescription>
                        Tembusan internal terkirim sendiri lewat sistem;
                        tembusan pihak luar hanya tercetak pada naskah, dan
                        pengantarannya di luar sistem.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {direction === LetterDirection.INCOMING && (
                <FormField
                  control={form.control}
                  name="recipientIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Teruskan Surat Masuk Kepada (Dapat memilih lebih dari 1)
                      </FormLabel>
                      <FormControl>
                        <div className="space-y-2 border rounded-md p-3">
                          <Input
                            placeholder="Cari penerima disposisi/terusan..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="text-xs mb-2 bg-white"
                          />
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {staffOptions.map((option: any) => (
                              <div
                                key={option.value}
                                className="flex items-center space-x-2"
                              >
                                <input
                                  type="checkbox"
                                  value={option.value}
                                  checked={(field.value || []).includes(
                                    option.value,
                                  )}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const current = field.value || [];
                                    if (checked) {
                                      field.onChange([
                                        ...current,
                                        option.value,
                                      ]);
                                    } else {
                                      field.onChange(
                                        current.filter(
                                          (val: string) => val !== option.value,
                                        ),
                                      );
                                    }
                                  }}
                                  className="h-4 w-4 rounded border-gray-300"
                                />
                                <label className="text-sm cursor-pointer">
                                  {option.label}
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Pilih pejabat/staf yang akan menerima terusan awal surat
                        masuk ini.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {direction === LetterDirection.INCOMING
                  ? "Asal & Tujuan"
                  : "Tujuan Surat"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {direction === LetterDirection.INCOMING && (
                <>
                  <FormField
                    control={form.control}
                    name="senderName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nama Pengirim</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Nama Instansi / Perorangan"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="senderInstance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Instansi Pengirim</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Dinas Pendidikan / Sekolah Lain"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <FormField
                control={form.control}
                name="recipientName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Penerima</FormLabel>
                    <FormControl>
                      <Input placeholder="Kepada Yth..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="recipientInstance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instansi Penerima</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Alamat / Instansi Tujuan"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fileUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Upload File Naskah (PDF)</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-4">
                        <Input
                          type="file"
                          accept=".pdf"
                          onChange={handleFileUpload}
                          disabled={uploading}
                        />
                        {uploading && (
                          <span className="text-sm text-muted-foreground">
                            Uploading...
                          </span>
                        )}
                      </div>
                    </FormControl>
                    {field.value && (
                      <FormDescription className="text-green-600 flex items-center gap-1">
                        <Upload className="h-3 w-3" /> Berkas naskah siap
                        dikirim
                      </FormDescription>
                    )}
                    {/*
                      Satu berkas, dua peran — dan perannya berbeda menurut arah
                      surat.

                      Surat keluar yang membawa berkas ini menjadikan berkas ini
                      naskahnya (`UPLOADED`): yang ditandatangani, di-hash,
                      diarsipkan, dan dicocokkan pada verifikasi publik adalah
                      byte berkas ini, ditambah cap TTE. Surat masuk tidak masuk
                      jalur tanda tangan elektronik kita; berkasnya adalah
                      pindaian asli yang diterima.

                      Dikatakan di sini karena penyusunlah yang memutuskan mana
                      yang berlaku, dan keputusan itu tidak dapat diubah setelah
                      surat ditandatangani.
                    */}
                    <p className="text-xs text-muted-foreground">
                      Untuk <strong>surat keluar</strong>, berkas PDF ini
                      menjadi naskah resminya: yang ditandatangani dan
                      diverifikasi. Susun naskahnya lengkap — kop, nomor, dan
                      tempat tanda tangan — karena sistem tidak menyusun ulang
                      tata letaknya. Untuk <strong>surat masuk</strong>, ini
                      pindaian surat yang diterima.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/*
                Lampiran, yang berbeda dari berkas naskah di atas.

                Yang di atas adalah naskahnya sendiri — satu berkas, pindaian
                atau unggahan. Lampiran adalah berkas yang *menyertainya*, dan
                jumlahnya diumumkan di kepala surat sebagai "Lampiran : 2 (dua)
                berkas" supaya penerima tahu apa yang seharusnya ia terima.
              */}
              <FormField
                control={form.control}
                name="attachments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lampiran</FormLabel>
                    <FormControl>
                      <div className="space-y-3">
                        <div className="flex items-center gap-4">
                          <Input
                            type="file"
                            onChange={handleAttachmentUpload}
                            disabled={uploadingAttachment}
                          />
                          {uploadingAttachment && (
                            <span className="text-sm text-muted-foreground">
                              Mengunggah...
                            </span>
                          )}
                        </div>
                        {(field.value || []).length > 0 && (
                          <ul className="space-y-2">
                            {(field.value || []).map((att, index) => (
                              <li
                                key={`${att.fileUrl}-${index}`}
                                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                              >
                                <span className="text-muted-foreground">
                                  {index + 1}.
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                  {att.name}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    field.onChange(
                                      (field.value || []).filter(
                                        (_, i) => i !== index,
                                      ),
                                    )
                                  }
                                >
                                  Hapus
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      Jumlahnya diumumkan pada kepala surat. Surat yang
                      menyatakan dua lampiran dan sampai tanpa keduanya adalah
                      surat yang kekurangannya dapat dibuktikan.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Isi Surat</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Ringkasan / Isi</FormLabel>
                      {/* Never overwrites silently: the draft is a starting
                          point, and losing typed text to a template is worse
                          than retyping the template. */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const draft = renderTemplateDraft(
                            form.getValues("type") ?? LetterType.SURAT_DINAS,
                            form.getValues("nature") ?? LetterNature.PUBLIC,
                          );
                          const current = (field.value ?? "").trim();
                          if (
                            current &&
                            !window.confirm(
                              "Ganti isi yang sudah ditulis dengan konsep template?",
                            )
                          ) {
                            return;
                          }
                          form.setValue("content", draft, {
                            shouldDirty: true,
                          });
                        }}
                      >
                        Isi dari template
                      </Button>
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder="Tuliskan isi ringkasan surat disini, atau klik “Isi dari template”..."
                        className="min-h-[220px] font-mono text-sm"
                        {...field}
                      />
                    </FormControl>
                    {/* What is still unfilled. A letter that climbs the
                        approval ladder with "[NAMA]" in it wastes every
                        reviewer's turn and comes straight back as a revision. */}
                    {leftoverPlaceholders.length > 0 && (
                      <p className="text-xs text-amber-600">
                        Masih ada isian yang belum dilengkapi:{" "}
                        <span className="font-medium">
                          {leftoverPlaceholders.join(", ")}
                        </span>
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button
              type="submit"
              variant="outline"
              className="flex-1"
              disabled={createLetter.isPending}
              onClick={() => setSubmitMode("DRAFT")}
            >
              Simpan Draft
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              disabled={createLetter.isPending}
              onClick={() => setSubmitMode("SUBMIT")}
            >
              Ajukan Review
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

/**
 * `useSearchParams` forces the subtree into client-side rendering, so it needs a
 * Suspense boundary above it or the whole route opts out of static generation.
 */
export default function CreateLetterPage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-6 text-muted-foreground">Memuat formulir…</div>
      }
    >
      <CreateLetterForm />
    </React.Suspense>
  );
}
