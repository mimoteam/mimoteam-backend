import type { ZodSchema } from "zod";
import type { Request, Response, NextFunction } from "express";

type Part = "body" | "query" | "params";

export function validate(schema: ZodSchema<any>, where: Part = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const toValidate: any = (req as any)[where];
    const result = schema.safeParse(toValidate);
    if (!result.success) {
      const details: any =
        (result as any).error?.format?.() ??
        (result as any).error?.errors ??
        null;
      return res
        .status(400)
        .json({ error: "Validation error", where, details });
    }
    (req as any)[where] = result.data; // sobrescreve com dados tipados/coergidos
    next();
  };
}

// Helpers convenientes, mantendo a facilidade de uso
export const validateBody = (schema: ZodSchema<any>) =>
  validate(schema, "body");
export const validateQuery = (schema: ZodSchema<any>) =>
  validate(schema, "query");
export const validateParams = (schema: ZodSchema<any>) =>
  validate(schema, "params");
