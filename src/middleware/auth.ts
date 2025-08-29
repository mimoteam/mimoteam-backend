import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  sub: string;
  role: "admin" | "partner" | "finance";
  iat?: number;
  exp?: number;
}

function extractToken(req: Request) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  // fallback: cookie
  const c = (req as any).cookies || {};
  return c.token || c.access_token || c.jwt || "";
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    (req as any).auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

export function requireRole(role: AuthPayload["role"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const current = (req as any).auth?.role;
    if (current !== role) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
