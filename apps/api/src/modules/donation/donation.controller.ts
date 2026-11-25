import { Request, Response, NextFunction } from 'express';
import { campaignService, donationService } from './donation.service';
import { ApiResponse } from '@/utils/response';
import { requireUser } from '@/middleware/auth';
import { wibMonthYear } from '@/utils/wib';

// =====================================
// CAMPAIGN CONTROLLER
// =====================================

export const campaignController = {
  /**
   * GET /api/donations/campaigns
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 10, status, unitId } = req.query;

      const result = await campaignService.findAll({
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        unitId: unitId as string,
      });

      res.json(
        ApiResponse.success(result.data, 'Campaigns retrieved successfully', result.pagination)
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/donations/campaigns/public
   */
  async listPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const campaigns = await campaignService.findPublic();
      res.json(ApiResponse.success(campaigns, 'Public campaigns retrieved successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/donations/campaigns/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const campaign = await campaignService.findById(req.params.id);

      if (!campaign) {
        return res.status(404).json(ApiResponse.error('Campaign not found'));
      }

      res.json(ApiResponse.success(campaign));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/donations/campaigns/slug/:slug
   */
  async getBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const campaign = await campaignService.findBySlug(req.params.slug);

      if (!campaign) {
        return res.status(404).json(ApiResponse.error('Campaign not found'));
      }

      res.json(ApiResponse.success(campaign));
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/donations/campaigns
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const campaign = await campaignService.create(req.body, user.id);
      res.status(201).json(ApiResponse.success(campaign, 'Campaign created successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/donations/campaigns/:id
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const campaign = await campaignService.update(req.params.id, req.body);
      res.json(ApiResponse.success(campaign, 'Campaign updated successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/donations/campaigns/:id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await campaignService.delete(req.params.id);
      res.json(ApiResponse.success(null, 'Campaign deleted successfully'));
    } catch (error) {
      next(error);
    }
  },
};

// =====================================
// DONATION CONTROLLER
// =====================================

export const donationController = {
  /**
   * GET /api/donations
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page = 1,
        limit = 10,
        campaignId,
        unitId,
        status,
        type,
        startDate,
        endDate,
        isAnonymous,
      } = req.query;

      const result = await donationService.findAll({
        page: Number(page),
        limit: Number(limit),
        campaignId: campaignId as string,
        unitId: unitId as string,
        status: status as string,
        type: type as string,
        startDate: startDate as string,
        endDate: endDate as string,
        isAnonymous: isAnonymous !== undefined ? isAnonymous === 'true' : undefined,
      });

      res.json(
        ApiResponse.success(result.data, 'Donations retrieved successfully', result.pagination)
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/donations/stats
   */
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { campaignId, unitId, type, startDate, endDate } = req.query;

      const stats = await donationService.getStats({
        campaignId: campaignId as string,
        unitId: unitId as string,
        type: type as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });

      res.json(ApiResponse.success(stats));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/donations/monthly-report
   */
  async getMonthlyReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { year = wibMonthYear(new Date()).year } = req.query;
      const report = await donationService.getMonthlyReport(Number(year));
      res.json(ApiResponse.success(report));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/donations/recent
   */
  async getRecent(req: Request, res: Response, next: NextFunction) {
    try {
      const { limit = 10 } = req.query;
      const donations = await donationService.getRecent(Number(limit));
      res.json(ApiResponse.success(donations));
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/donations/:id
   */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const donation = await donationService.findById(req.params.id);

      if (!donation) {
        return res.status(404).json(ApiResponse.error('Donation not found'));
      }

      res.json(ApiResponse.success(donation));
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/donations
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const donation = await donationService.create(req.body);
      res.status(201).json(ApiResponse.success(donation, 'Donation recorded successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/donations/public
   * Public donation (no auth required)
   */
  async createPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const donation = await donationService.createPublic(req.body);
      res.status(201).json(
        ApiResponse.success(
          {
            id: donation.id,
            amount: donation.amount,
            type: donation.type,
            status: donation.status,
            message: 'Terima kasih atas donasi Anda. Donasi akan diverifikasi oleh admin.',
          },
          'Donation submitted successfully'
        )
      );
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/donations/:id/verify
   */
  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const donation = await donationService.verify(req.params.id, user.id, req.body);
      res.json(ApiResponse.success(donation, 'Donation verified successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/donations/:id
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const donation = await donationService.update(req.params.id, req.body);
      res.json(ApiResponse.success(donation, 'Donation updated successfully'));
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/donations/:id
   */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await donationService.delete(req.params.id);
      res.json(ApiResponse.success(null, 'Donation deleted successfully'));
    } catch (error) {
      next(error);
    }
  },
};

export default {
  campaign: campaignController,
  donation: donationController,
};
