import { Request, Response, NextFunction } from 'express';
import * as service from './accounting.service';
import * as reportsService from './reports.service';
import * as configService from './accounting-config.service';
import {
  wibDayBound,
  wibDayOf,
  wibMonthRange,
  wibMonthYear,
  wibYearBounds,
} from '../../utils/wib-day';
import {
  CreateAccountDto,
  CreateJournalDto,
  UpdateAccountDto,
  saveReportNoteSchema,
} from './finance.schema';

// =====================================
// ACCOUNTS
// =====================================

export async function seedAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.seedDefaultAccounts();
    res.status(201).json({ message: 'Accounts seeded successfully', data: result });
  } catch (error) {
    next(error);
  }
}

export async function createAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const data: CreateAccountDto = req.body;
    const account = await service.createAccount(data);
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
}

export async function updateAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data: UpdateAccountDto = req.body;
    const account = await service.updateAccount(id, data);
    res.json(account);
  } catch (error) {
    next(error);
  }
}

export async function getAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as { search?: string; type?: string; isActive?: string };
    const accounts = await service.getAccounts({
      ...query,
      isActive: query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined,
    });
    res.json({ data: accounts });
  } catch (error) {
    next(error);
  }
}

export async function getAccountById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const account = await service.getAccountById(id);
    if (!account) {
      res.status(404).json({ message: 'Account not found' });
      return;
    }
    res.json(account);
  } catch (error) {
    next(error);
  }
}

export async function deleteAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await service.deleteAccount(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// =====================================
// SETTINGS
// =====================================

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const { unitId } = req.query;
    if (!unitId) {
      res.status(400).json({ message: 'Unit ID is required' });
      return;
    }

    const keys = Object.values(configService.ACCOUNT_MAPPING_KEYS);
    const settings: Record<string, string | null> = {};

    for (const key of keys) {
      settings[key] = await configService.getAccountMapping(unitId as string, key);
    }

    res.json({ data: settings });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const { unitId, settings } = req.body;
    if (!unitId || !settings) {
      res.status(400).json({ message: 'Unit ID and settings are required' });
      return;
    }

    for (const [key, accountId] of Object.entries(settings)) {
      if (accountId) {
        await configService.setAccountMapping(unitId, key, accountId as string);
      }
    }

    res.json({ message: 'Settings updated' });
  } catch (error) {
    next(error);
  }
}

// =====================================
// JOURNALS
// =====================================

export async function createJournal(req: Request, res: Response, next: NextFunction) {
  try {
    const data: CreateJournalDto = req.body;
    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    const journals = await service.createManualJournal({
      ...data,
      date: new Date(data.date),
      createdById: userId,
    });
    res.status(201).json({ data: journals });
  } catch (error) {
    next(error);
  }
}

export async function getJournals(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    const result = await service.getJournals({
      ...query,
      startDate: query.startDate ? wibDayBound(query.startDate, 'start') : undefined,
      endDate: query.endDate ? wibDayBound(query.endDate, 'end') : undefined,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 20,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// =====================================
// REPORTS
// =====================================

export async function getTrialBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    const result = await service.getTrialBalance({
      unitId: query.unitId,
      startDate: query.startDate ? wibDayBound(query.startDate, 'start') : undefined,
      endDate: query.endDate ? wibDayBound(query.endDate, 'end') : undefined,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function getBalanceSheet(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    // Default to the end of today WIB if not specified
    const endDate = query.endDate
      ? wibDayBound(query.endDate, 'end')
      : wibDayBound(wibDayOf(new Date()), 'end');

    const result = await service.getBalanceSheet({
      unitId: query.unitId,
      endDate,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function getIncomeStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    // Default to the current WIB month if not specified
    const { year, month } = wibMonthYear(new Date());
    const bounds = wibMonthRange(year, month);
    const startDate = query.startDate ? wibDayBound(query.startDate, 'start') : bounds.start;
    const endDate = query.endDate ? wibDayBound(query.endDate, 'end') : bounds.end;

    const result = await service.getIncomeStatement({
      unitId: query.unitId,
      startDate,
      endDate,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

// =====================================
// ISAK 35 / PSAK 109 REPORTS + CALK
// =====================================

export async function getStatementOfActivities(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    // Default to the current WIB year so far if not specified
    const startDate = query.startDate
      ? wibDayBound(query.startDate, 'start')
      : wibYearBounds(new Date()).start;
    const endDate = query.endDate
      ? wibDayBound(query.endDate, 'end')
      : wibDayBound(wibDayOf(new Date()), 'end');

    const result = await reportsService.getStatementOfActivities({
      unitId: query.unitId,
      startDate,
      endDate,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function getZiswafReport(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    // Default to the current WIB year so far if not specified
    const startDate = query.startDate
      ? wibDayBound(query.startDate, 'start')
      : wibYearBounds(new Date()).start;
    const endDate = query.endDate
      ? wibDayBound(query.endDate, 'end')
      : wibDayBound(wibDayOf(new Date()), 'end');

    const result = await reportsService.getZiswafReport({
      unitId: query.unitId,
      startDate,
      endDate,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function getBudgetVsActualReport(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    if (!query.unitId || !query.academicYearId) {
      res.status(400).json({ message: 'unitId and academicYearId are required' });
      return;
    }

    const result = await reportsService.getBudgetVsActualReport({
      unitId: query.unitId,
      academicYearId: query.academicYearId,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function getCalkData(req: Request, res: Response, next: NextFunction) {
  try {
    const query = req.query as any;
    if (!query.unitId) {
      res.status(400).json({ message: 'unitId is required' });
      return;
    }

    const result = await reportsService.getCalkData({
      unitId: query.unitId,
      periodId: query.periodId,
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function saveReportNote(req: Request, res: Response, next: NextFunction) {
  try {
    const data = saveReportNoteSchema.parse(req.body);
    const result = await reportsService.saveReportNote(data);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}
