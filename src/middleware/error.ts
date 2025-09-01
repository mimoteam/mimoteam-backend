import { ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";


export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
if (err instanceof ZodError) {
return res.status(400).json({ ok: false, error: "validation_error", issues: err.issues });
}
const status = err.status || 500;
const message = status === 500 ? "internal_error" : err.message || "error";
if (status === 500) console.error(err);
return res.status(status).json({ ok: false, error: message });
}