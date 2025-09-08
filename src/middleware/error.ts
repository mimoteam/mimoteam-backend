// src/middleware/error.ts
import { ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";

export function notFound(req: Request, res: Response) {
  res.status(404).json({ ok: false, error: "not_found", path: req.originalUrl });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: "validation_error", issues: err.issues });
  }
  const status = Number(err?.status || err?.statusCode || 500);
  const message = status === 500 ? "internal_error" : (err?.message || "error");
  if (status === 500) console.error("[ERROR]", err);
  return res.status(status).json({ ok: false, error: message });
}
