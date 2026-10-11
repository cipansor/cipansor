import { z } from "zod";
import {
  LetterDirection,
  LetterDispatchChannel,
  LetterUrgency,
  LetterNature,
  LetterStatus,
  LetterType,
} from "../types/correspondence";

export const listParticipantsQuerySchema = z.object({
  search: z.string().optional(),
  unitId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

export type ListParticipantsQueryInput = z.infer<
  typeof listParticipantsQuerySchema
>;

/**
 * Satu lampiran. `fileUrl` sudah harus ada — berkasnya diunggah lebih dulu
 * lewat POST /upload, dan yang disimpan di sini hanyalah rujukannya.
 */
export const letterAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  fileUrl: z.string().min(1).max(1024),
  mimeType: z.string().max(128).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export type LetterAttachmentSchemaInput = z.infer<
  typeof letterAttachmentSchema
>;

/**
 * Satu baris tembusan. Persis satu dari kedua bentuknya.
 *
 * Menerima keduanya sekaligus akan menghasilkan baris yang tidak dapat
 * dicetak tanpa memilih salah satu diam-diam, dan menerima keduanya kosong
 * menghasilkan nomor urut tanpa nama.
 */
export const letterCcSchema = z
  .object({
    userId: z.string().uuid().optional(),
    externalName: z.string().trim().min(1).max(255).optional(),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.externalName), {
    message:
      "Tembusan diisi pengguna internal atau nama pihak luar, bukan keduanya",
  });

export type LetterCcSchemaInput = z.infer<typeof letterCcSchema>;

/** Mengganti seluruh daftar tembusan sebuah naskah yang belum ditandatangani. */
export const updateLetterCcSchema = z.object({
  ccRecipients: z.array(letterCcSchema).max(30),
});

export type UpdateLetterCcSchemaInput = z.infer<typeof updateLetterCcSchema>;

export const createLetterSchema = z.object({
  unitId: z.string().uuid(),
  direction: z.nativeEnum(LetterDirection),
  type: z.nativeEnum(LetterType).optional(),
  classificationId: z.string().uuid().optional(),
  agendaNumber: z.string().optional(),
  letterNumber: z.string().optional(),
  date: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "Tanggal surat tidak sah",
    }),
  receivedAt: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
      message: "Tanggal penerimaan tidak sah",
    }),
  subject: z.string().min(1),
  content: z.string().optional(),
  fileUrl: z.string().url().optional(),
  urgency: z.nativeEnum(LetterUrgency),
  nature: z.nativeEnum(LetterNature),
  status: z.nativeEnum(LetterStatus),
  senderName: z.string().optional(),
  senderTitle: z.string().optional(),
  senderInstance: z.string().optional(),
  recipientName: z.string().optional(),
  recipientInstance: z.string().optional(),
  reviewerIds: z.array(z.string().uuid()).optional(),
  recipientIds: z.array(z.string().uuid()).optional(),
  ccRecipients: z.array(letterCcSchema).max(30).optional(),
  attachments: z.array(letterAttachmentSchema).max(20).optional(),
});

export type CreateLetterSchemaInput = z.infer<typeof createLetterSchema>;

export const reviewLetterSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().optional(),
  nextReviewerId: z.string().uuid().optional(),
  isFinalSigner: z.boolean().optional(),
});

export type ReviewLetterSchemaInput = z.infer<typeof reviewLetterSchema>;

export const createDispositionSchema = z
  .object({
    letterId: z.string().uuid(),
    recipientId: z.string().uuid().optional(),
    recipientIds: z.array(z.string().uuid()).optional(),
    instruction: z.string().min(1),
    deadline: z.string().optional(),
    parentDispositionId: z.string().uuid().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) =>
      data.recipientId || (data.recipientIds && data.recipientIds.length > 0),
    {
      message: "Harus memilih minimal satu penerima disposisi",
      path: ["recipientIds"],
    },
  );

export type CreateDispositionSchemaInput = z.infer<
  typeof createDispositionSchema
>;

export const updateDispositionStatusSchema = z.object({
  status: z.enum(["IN_PROGRESS", "COMPLETED"]),
  notes: z.string().optional(),
});

export type UpdateDispositionStatusSchemaInput = z.infer<
  typeof updateDispositionStatusSchema
>;

export const letterNoteSchema = z.object({
  note: z.string().max(2000).optional(),
});

export type LetterNoteSchemaInput = z.infer<typeof letterNoteSchema>;

/**
 * Pencatatan pengiriman naskah keluar.
 *
 * `dispatchedAt` boleh mundur — petugas sering mencatat setelah kurir kembali —
 * tetapi tidak boleh maju: sebuah surat tidak dapat dikirim besok, dan tanggal
 * kirim yang mendahului hari ini adalah satu-satunya angka yang membuat
 * statistik "surat terkirim" salah tanpa terlihat salah.
 */
export const dispatchLetterSchema = z.object({
  channel: z.nativeEnum(LetterDispatchChannel),
  dispatchedAt: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
      message: "Tanggal pengiriman tidak sah",
    })
    .refine((v) => !v || Date.parse(v) <= Date.now() + 60_000, {
      message: "Tanggal pengiriman tidak boleh di masa depan",
    }),
  receivedByName: z.string().max(255).optional(),
  trackingNumber: z.string().max(120).optional(),
  receiptUrl: z.string().max(1024).optional(),
  note: z.string().max(2000).optional(),
});

export type DispatchLetterSchemaInput = z.infer<typeof dispatchLetterSchema>;

export const submitLetterSchema = z.object({
  note: z.string().max(2000).optional(),
  reviewerIds: z.array(z.string().uuid()).optional(),
});

export type SubmitLetterSchemaInput = z.infer<typeof submitLetterSchema>;

export const updateLetterSchema = z.object({
  type: z.nativeEnum(LetterType).optional(),
  classificationId: z.string().uuid().optional().nullable(),
  // A malformed `date`/`receivedAt` used to reach `new Date(...)` in the
  // service and surface as a 500. Reject it at the edge as a 400 instead.
  date: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "Tanggal surat tidak sah",
    })
    .optional(),
  receivedAt: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
      message: "Tanggal penerimaan tidak sah",
    }),
  subject: z.string().min(1).optional(),
  content: z.string().optional(),
  fileUrl: z.string().url().optional().nullable(),
  urgency: z.nativeEnum(LetterUrgency).optional(),
  nature: z.nativeEnum(LetterNature).optional(),
  senderName: z.string().optional().nullable(),
  senderTitle: z.string().optional().nullable(),
  senderInstance: z.string().optional().nullable(),
  recipientName: z.string().optional().nullable(),
  recipientInstance: z.string().optional().nullable(),
  reviewerIds: z.array(z.string().uuid()).optional(),
  recipientIds: z.array(z.string().uuid()).optional(),
  ccRecipients: z.array(letterCcSchema).max(30).optional(),
  attachments: z.array(letterAttachmentSchema).max(20).optional(),
});

export type UpdateLetterSchemaInput = z.infer<typeof updateLetterSchema>;

/**
 * Penyaring ekspor buku agenda.
 *
 * Buku agenda adalah daftar, jadi masukannya pun daftar: arah, rentang tanggal,
 * status, pencarian, dan cakupannya (seluruh unit atau disposisi pribadi).
 * Semua penyaring yang tampak di layar ikut, supaya berkas yang diserahkan
 * memuat baris yang diperiksa petugas — bukan lebih.
 *
 * Rentang tanggal dibatasi satu tahun buku (366 hari) ketika kedua ujungnya
 * diisi: buku agenda dibaca per tahun buku, dan tanpa batas ini sebuah
 * permintaan dapat menyedot seluruh riwayat sekaligus. Bila salah satu ujung
 * kosong, batasnya tidak dapat dihitung dan tidak ditegakkan — itu disengaja,
 * karena daftar tetap dibatasi cakupan akses aktornya.
 */
const MAX_AGENDA_RANGE_DAYS = 366;

export const exportAgendaQuerySchema = z
  .object({
    direction: z.nativeEnum(LetterDirection).optional(),
    status: z.nativeEnum(LetterStatus).optional(),
    search: z.string().max(200).optional(),
    scope: z.enum(["ALL", "PERSONAL"]).optional(),
    from: z
      .string()
      .optional()
      .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
        message: "Tanggal awal tidak sah",
      }),
    to: z
      .string()
      .optional()
      .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
        message: "Tanggal akhir tidak sah",
      }),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    if (to < from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "Tanggal akhir mendahului tanggal awal",
      });
      return;
    }
    const days = (to - from) / 86_400_000;
    if (days > MAX_AGENDA_RANGE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `Rentang buku agenda paling lama ${MAX_AGENDA_RANGE_DAYS} hari`,
      });
    }
  });

export type ExportAgendaQueryInput = z.infer<typeof exportAgendaQuerySchema>;
