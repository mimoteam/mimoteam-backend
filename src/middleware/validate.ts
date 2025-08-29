import type { ZodSchema } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export const validate =
  (schema: ZodSchema<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // v3: error.format(); v4: ainda existe; fallback para errors
      const details: any = (result as any).error?.format?.() ?? (result as any).error?.errors ?? null;
      return res.status(400).json({ error: 'Validation error', details });
    }
    req.body = result.data;
    next();
  };
