import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * The schema a `validate*` middleware was built from, readable by the
 * `validate-schema-shape.guard.test.ts` guard. A symbol, not a string, so it
 * never collides with a real property and stays out of `Object.keys`.
 */
export const VALIDATED_SCHEMA = Symbol('validatedSchema');

interface TaggedMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  [VALIDATED_SCHEMA]?: ZodSchema;
}

function tag<T extends TaggedMiddleware>(fn: T, schema: ZodSchema): T {
  fn[VALIDATED_SCHEMA] = schema;
  return fn;
}

/**
 * Validation middleware for request body
 */
export function validate<T>(schema: ZodSchema<T>) {
  return tag((req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  }, schema as ZodSchema);
}

/**
 * Validate query params (parses and stores in res.locals.validatedQuery)
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return tag((req: Request, res: Response, next: NextFunction) => {
    try {
      // In Express 5, req.query is read-only, so we validate and store in res.locals
      res.locals.validatedQuery = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  }, schema as ZodSchema);
}

/**
 * Validate URL params
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return tag((req: Request, res: Response, next: NextFunction) => {
    try {
      // Just validate, params is also read-only in Express 5
      schema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  }, schema as ZodSchema);
}
