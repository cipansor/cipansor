import { Request, Response, NextFunction } from 'express';
import { organisasiService } from './organisasi.service';

export const getOrgUnits = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const unitId = (req.query.unitId as string) || req.user?.unitId;
    if (!unitId) {
      res.status(400).json({ error: 'unitId is required' });
      return;
    }
    const data = await organisasiService.getOrgUnits(unitId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const getOrgTree = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const unitId = (req.query.unitId as string) || req.user?.unitId;
    if (!unitId) {
      res.status(400).json({ error: 'unitId is required' });
      return;
    }
    const data = await organisasiService.getOrgTree(unitId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const getOrgUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await organisasiService.getOrgUnit(req.params.id);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const createOrgUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await organisasiService.createOrgUnit(req.body);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updateOrgUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await organisasiService.updateOrgUnit(req.params.id, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deleteOrgUnit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await organisasiService.deleteOrgUnit(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

export const getPositions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await organisasiService.getPositions(req.params.orgUnitId);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const getAllPositions = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await organisasiService.getAllPositions();
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const getPositionById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const position = await organisasiService.getPositionById(req.params.id);
    if (!position) {
      res.status(404).json({ error: 'Posisi tidak ditemukan' });
      return;
    }
    const parentPosition = await organisasiService.getParentPosition(position.orgUnitId);
    res.json({ data: { ...position, parentPosition } });
  } catch (error) {
    next(error);
  }
};

export const createPosition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await organisasiService.createPosition(req.body);
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

export const updatePosition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await organisasiService.updatePosition(req.params.id, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
};

export const deletePosition = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await organisasiService.deletePosition(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
