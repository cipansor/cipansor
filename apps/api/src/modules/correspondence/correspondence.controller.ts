import { Request, Response } from 'express';
import { CorrespondenceService } from './correspondence.service';
import { asyncHandler, Errors } from '@/middleware/error';
import { ApiResponse } from '@/utils/response';
import { resolveLetterPdf } from './signed-pdf';
import { choosesUnit, handlesUnitCorrespondence, type LetterActor } from '@/utils/letter-access';
import type { ExportAgendaQueryInput } from '@cipansor/shared';

/**
 * The caller, in the shape the access rules expect.
 *
 * Scoping decisions here must be made on `roleCode`. The previous version
 * branched on the legacy `role`, and since deriveLegacyRole() maps every
 * YAYASAN_* code onto 'UNIT_ADMIN', the yayasan board fell through to the
 * "no unit assigned" branch and was answered with 403 — the sekretaris and
 * ketua yayasan could not open the letter list their own workflow depends on.
 */
function actorOf(req: Request): LetterActor {
  return {
    id: req.user!.id,
    role: req.user?.role,
    roleCode: req.user?.roleCode,
    unitId: req.user?.unitId,
  };
}

export const CorrespondenceController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.createLetter(req.body, req.user!.id, actorOf(req));
    res.status(201).json(ApiResponse.success(result));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.updateLetter(
      req.params.id,
      req.body,
      req.user!.id,
      actorOf(req)
    );
    res.json(ApiResponse.success(result));
  }),

  findAll: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    const unitId = choosesUnit(actor) ? (req.query.unitId as string | undefined) : undefined;

    const result = await CorrespondenceService.getLetters(unitId, {
      actor,
      page: Number(req.query.page),
      limit: Number(req.query.limit),
      direction: req.query.direction as any,
      status: req.query.status as any,
      search: req.query.search as string,
      scope: req.query.scope as any,
      userId: req.user!.id,
    });
    res.json(ApiResponse.success(result.data, undefined, result.meta));
  }),

  findOne: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.getLetterById(req.params.id, actorOf(req));
    res.json(ApiResponse.success(result));
  }),

  /**
   * Buku agenda sebagai CSV yang dapat diunduh.
   *
   * `Content-Disposition: attachment` dengan nama berkas berbahasa Indonesia —
   * petugas arsip yang menerimanya harus tahu ini berkas apa tanpa membukanya.
   *
   * Membaca `res.locals.validatedQuery`, bukan `req.query`: rutenya memasang
   * `validateQuery`, dan membaca mentah dari `req.query` akan membuat validasi
   * itu tidak berguna — persis kesalahan yang pernah terjadi pada daftar santri
   * (lihat `students/student.controller.ts`). Nilai yang tidak lolos skema
   * tidak boleh sampai ke layanan.
   */
  exportAgenda: asyncHandler(async (req: Request, res: Response) => {
    const filters = res.locals.validatedQuery as ExportAgendaQueryInput;
    const csv = await CorrespondenceService.exportAgendaCsv(actorOf(req), {
      direction: filters.direction,
      status: filters.status,
      search: filters.search,
      scope: filters.scope,
      from: filters.from,
      to: filters.to,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Buku-Agenda-${stamp}.csv"`);
    res.send(csv);
  }),

  getPdf: asyncHandler(async (req: Request, res: Response) => {
    const letter = await CorrespondenceService.getLetterById(req.params.id, actorOf(req));
    if (!letter) {
      throw Errors.notFound('Surat tidak ditemukan');
    }

    /**
     * A signed letter is served from the archive, never re-rendered.
     *
     * `resolveLetterPdf` holds the whole rule, including why: the bytes that
     * were hashed at signing are the only bytes that can still be verified, and
     * regenerating them is a promise no living dependency tree can keep.
     *
     * A withdrawn letter is still printed — stamped DICABUT, not refused. The
     * office still has to file a copy, and whoever is already holding the
     * letter deserves a sheet that explains itself. Electronic-signature
     * platforms do the same: DocuSign watermarks a voided envelope VOID and
     * keeps it downloadable.
     */
    const { buffer, source } = await resolveLetterPdf(letter);

    const fileName = `Surat-${letter.letterNumber || letter.agendaNumber || 'Draft'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    // Terbaca di alat pemeriksa: naskah yang disajikan dari arsip adalah naskah
    // yang byte-nya memang ditandatangani, bukan hasil render ulang.
    res.setHeader('X-Naskah-Source', source);
    res.send(buffer);
  }),

  review: asyncHandler(async (req: Request, res: Response) => {
    const { action, notes, nextReviewerId, isFinalSigner } = req.body;
    const result = await CorrespondenceService.processReview(
      req.params.id,
      req.user!.id,
      action,
      notes,
      nextReviewerId,
      isFinalSigner,
      actorOf(req)
    );
    res.json(ApiResponse.success(result));
  }),

  submitForReview: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.submitForReview(
      req.params.id,
      actorOf(req),
      req.body?.note,
      req.body?.reviewerIds
    );
    res.json(ApiResponse.success(result));
  }),

  resubmit: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.resubmitLetter(
      req.params.id,
      actorOf(req),
      req.body?.note
    );
    res.json(ApiResponse.success(result));
  }),

  /**
   * Daftar tembusan, diganti utuh.
   *
   * Antarmuka menyunting daftarnya — menambah baris, menghapus baris, memilih
   * pihak dalam atau menuliskan nama pihak luar — lalu mengirimkan hasil
   * akhirnya. Urutan baris adalah bagian dari isinya.
   */
  updateCc: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.updateLetterCc(
      req.params.id,
      actorOf(req),
      req.body.ccRecipients
    );
    res.json(ApiResponse.success(result));
  }),

  /**
   * Buku ekspedisi: naskah ini benar-benar keluar dari kantor.
   *
   * Terpisah dari `archive` dengan sengaja — mengirim dan mengarsipkan adalah
   * dua perbuatan yang berbeda, oleh orang yang bisa saja berbeda, dan sebuah
   * surat yang sudah dikirim masih menunggu untuk diarsipkan.
   */
  dispatch: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.dispatchLetter(
      req.params.id,
      actorOf(req),
      req.body
    );
    res.status(201).json(ApiResponse.success(result));
  }),

  archive: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.archiveLetter(
      req.params.id,
      actorOf(req),
      req.body?.note
    );
    res.json(ApiResponse.success(result));
  }),

  createDisposition: asyncHandler(async (req: Request, res: Response) => {
    const result = await CorrespondenceService.createDisposition(
      { ...req.body, senderId: req.user!.id },
      actorOf(req)
    );
    res.status(201).json(ApiResponse.success(result));
  }),

  updateDispositionStatus: asyncHandler(async (req: Request, res: Response) => {
    const { status, notes } = req.body;
    const result = await CorrespondenceService.updateDispositionStatus(
      req.params.id,
      status,
      notes,
      req.user!.id
    );
    res.json(ApiResponse.success(result));
  }),

  getStats: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);

    if (!choosesUnit(actor) && !handlesUnitCorrespondence(actor)) {
      throw Errors.forbidden('Anda tidak memiliki akses ke statistik persuratan');
    }

    const unitId = choosesUnit(actor)
      ? (req.query.unitId as string | undefined)
      : (actor.unitId ?? undefined);

    const result = await CorrespondenceService.getDashboardStats(unitId);
    res.json(ApiResponse.success(result));
  }),

  getParticipants: asyncHandler(async (req: Request, res: Response) => {
    const query = (res.locals.validatedQuery || req.query) as {
      search?: string;
      unitId?: string;
      limit?: number;
    };
    const result = await CorrespondenceService.getParticipants(
      {
        search: query.search,
        unitId: query.unitId,
        limit: query.limit,
      },
      actorOf(req)
    );
    res.json(ApiResponse.success(result));
  }),

  /**
   * Daftar naskah yang masa retensinya sudah lewat.
   *
   * Hanya jabatan yang mengurus surat yang boleh membukanya. Daftar ini memuat
   * perihal dan klasifikasi, dan bagi naskah Rahasia itu berarti ia hanya boleh
   * sampai ke orang yang ada di dalam rantai suratnya — bukan ke setiap akun
   * yang kebetulan punya `unitId`.
   */
  reviewRetention: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    if (!choosesUnit(actor) && !handlesUnitCorrespondence(actor)) {
      throw Errors.forbidden('Anda tidak memiliki akses ke peninjauan retensi arsip');
    }
    const result = await CorrespondenceService.reviewRetention(actor);
    res.json(ApiResponse.success(result));
  }),

  exportRetention: asyncHandler(async (req: Request, res: Response) => {
    const actor = actorOf(req);
    if (!choosesUnit(actor) && !handlesUnitCorrespondence(actor)) {
      throw Errors.forbidden('Anda tidak memiliki akses ke peninjauan retensi arsip');
    }
    const csv = await CorrespondenceService.exportRetentionCsv(actor);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Peninjauan-Retensi-${stamp}.csv"`);
    res.send(csv);
  }),
};
