// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export type Role = "admin" | "partner" | "finance";

export interface AuthPayload extends JwtPayload {
  sub: string;
  role: Role;
  iat?: number;
  exp?: number;
}

// Augmenta o tipo do Express p/ enxergar req.auth
declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthPayload;
  }
}

function extractToken(req: Request): string {
  const h = req.headers.authorization ?? "";
  if (h && /^bearer\s+/i.test(h)) return h.slice(7).trim();

  // cookies comuns
  const c: any = (req as any).cookies || {};
  if (typeof c.token === "string") return c.token;
  if (typeof c.access_token === "string") return c.access_token;
  if (typeof c.jwt === "string") return c.jwt;

  // opcional: ?token=...
  const q = req.query?.token;
  if (typeof q === "string") return q;

  return "";
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.setHeader("WWW-Authenticate", "Bearer");
    return res.status(401).json({ error: "missing token" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[auth] JWT_SECRET not set");
    return res.status(500).json({ error: "server misconfigured" });
  }

  try {
    const payload = jwt.verify(token, secret) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    return res.status(401).json({ error: "invalid token" });
  }
}

// Aceita um papel ou lista de papéis.
// Admin sempre passa (superuser).
export function requireRole(role: Role | Role[]) {
  const roles = Array.isArray(role) ? role : [role];
  return (req: Request, res: Response, next: NextFunction) => {
    const current = req.auth?.role;
    if (!current) return res.status(401).json({ error: "unauthenticated" });
    if (current === "admin") return next();
    if (!roles.includes(current)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

/** Helper: permite `auth()` ou `auth("admin")` ou `auth(["admin","finance"])` */
export function auth(role?: Role | Role[]) {
  if (!role) return requireAuth;
  return (req: Request, res: Response, next: NextFunction) =>
    requireAuth(req, res, () => requireRole(role)(req, res, next));
}
