// Generic body/query validators backed by Zod. Replace TS casts with
// runtime validation so malformed input fails 400 instead of crashing
// deep in the route handler.

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      res.status(400).json({ error: 'Invalid request body', details: issues });
      return;
    }
    // Replace body with parsed (coerced) value
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      res.status(400).json({ error: 'Invalid query params', details: issues });
      return;
    }
    // req.query is read-only in Express 5 — store on res.locals for the handler
    (res.locals as Record<string, unknown>).query = result.data;
    next();
  };
}
