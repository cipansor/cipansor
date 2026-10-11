import { Request, Response, NextFunction } from 'express';
import { SigningKeyRequestStatus } from '@prisma/client';
import { EsignService } from './esign.service';
import { asyncHandler, Errors } from '@/middleware/error';
import { ApiResponse } from '@/utils/response';

export const EsignController = {
  async myStatus(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await EsignService.myStatus(req.user!.id) });
    } catch (e) {
      next(e);
    }
  },

  /** Identitas yang mendasari kunci — diisi pemohon, dinyatakan benar orang lain. */
  async saveIdentity(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.saveMyIdentity(req.user!.id, req.body);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  /** Foto KTP pemohon — satu-satunya jalur pembuktian identitas. */
  async uploadIdentityDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) throw Errors.badRequest('Berkas foto KTP wajib diunggah.');
      const data = await EsignService.uploadIdentityDocument(req.user!.id, req.file);
      res.status(201).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  /**
   * Membaca foto KTP seorang pemohon. Super Admin saja, dan tercatat.
   *
   * Dikirim dengan `Content-Disposition: inline` dan tanpa cache: berkas ini
   * berumur pendek dengan sengaja, dan salinan yang tertinggal di cache
   * peramban akan hidup lebih lama daripada aslinya.
   */
  async readIdentityDocument(req: Request, res: Response, next: NextFunction) {
    try {
      const { buffer, contentType } = await EsignService.readIdentityDocument(
        req.params.userId,
        req.user!.id
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline; filename="ktp"');
      res.setHeader('Cache-Control', 'no-store, private');
      res.send(buffer);
    } catch (e) {
      next(e);
    }
  },

  async requestKey(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.requestKey(req.user!.id, req.body?.reason);
      res.status(201).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  async activate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.activateKey(req.user!.id, req.body.passphrase);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  async changePassphrase(req: Request, res: Response, next: NextFunction) {
    try {
      const { currentPassphrase, accountPassword, newPassphrase } = req.body;
      const data = await EsignService.changePassphrase(
        req.user!.id,
        currentPassphrase,
        accountPassword,
        newPassphrase
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  async listRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const status = req.query.status as SigningKeyRequestStatus | undefined;
      res.json({ success: true, data: await EsignService.listRequests(status) });
    } catch (e) {
      next(e);
    }
  },

  async decide(req: Request, res: Response, next: NextFunction) {
    try {
      const { approve, grantedDays, note, identityVerification } = req.body;
      const data = await EsignService.decideRequest(
        req.params.id,
        req.user!.id,
        approve,
        grantedDays,
        note,
        identityVerification
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  async listKeys(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await EsignService.listKeys() });
    } catch (e) {
      next(e);
    }
  },

  async revoke(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.revokeKey(
        req.params.userId,
        req.user!.id,
        req.body.reason,
        req.body.code
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  /** Cabut tanda tangan pada surat — penandatangannya sendiri atau Super Admin. */
  async revokeSignature(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.revokeLetterSignature(
        req.params.letterId,
        { id: req.user!.id, roleCode: req.user!.roleCode },
        req.body.reason,
        req.body.passphrase
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  /** Ajukan pencabutan — siapa pun yang boleh membaca suratnya. */
  async requestRevocation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.requestRevocation(
        req.params.letterId,
        { id: req.user!.id, roleCode: req.user!.roleCode, unitId: req.user!.unitId },
        req.body.reason,
        req.body.attachmentUrl
      );
      res.status(201).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  /** Antrean permohonan — disaring pada kewenangan pemanggilnya. */
  async listRevocationRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.listRevocationRequests(
        { id: req.user!.id, roleCode: req.user!.roleCode },
        req.query.status as never
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  async decideRevocation(req: Request, res: Response, next: NextFunction) {
    try {
      const { approve, note, passphrase, reason } = req.body;
      const data = await EsignService.decideRevocation(
        req.params.id,
        { id: req.user!.id, roleCode: req.user!.roleCode },
        approve,
        { note, passphrase, reason }
      );
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  async withdrawRevocationRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.withdrawRevocationRequest(req.params.id, req.user!.id);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  async signLetter(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await EsignService.signLetter(
        req.params.letterId,
        req.user!.id,
        req.body.passphrase,
        req.user!.roleCode,
        {
          form: req.body.signingAuthorityForm,
          representedOffice: req.body.representedOffice,
        }
      );
      res.status(201).json({ success: true, data });
    } catch (e) {
      next(e);
    }
  },

  /** Publik: dipanggil halaman verifikasi setelah QR dipindai. */

  /** Publik: dipanggil halaman verifikasi publik via upload PDF. */
  // Pemeriksaan anti-bot sudah selesai sebelum handler ini dipanggil, di
  // `requireTurnstile` pada rutenya. Handler tetap memeriksa berkasnya sendiri.
  verifyPdf: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file || !req.file.buffer) {
      throw Errors.badRequest('File PDF wajib diunggah.');
    }

    const result = await EsignService.verifyByPdfBuffer(req.file.buffer);
    res.json(ApiResponse.success(result));
  }),

  /**
   * Layanan status kunci publik (AATL ICA7) — dibaca dari query string.
   *
   * Sidik jari sengaja di query, bukan di path: nilainya berisi titik dua, dan
   * sebuah segmen path yang mengembalikan 400 bagi bentuk tanpa pemisah adalah
   * permukaan yang mudah salah. Divalidasi `validateQuery` sehingga bentuknya
   * diperiksa sebelum menyentuh basis data.
   */
  keyStatus: asyncHandler(async (_req: Request, res: Response) => {
    const { fingerprint } = res.locals.validatedQuery as { fingerprint: string };
    const result = await EsignService.publicKeyStatus(fingerprint);
    res.json(ApiResponse.success(result));
  }),
};
