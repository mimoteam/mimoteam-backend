// src/middleware/auth.v2.ts
import type { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";

/** Payload esperado dentro do JWT */
export type JwtUser = JwtPayload & {
  _id: string;
  role?: string;
  userType?: string;
  email?: string;
  fullName?: string;
  name?: string;
  [k: string]: any;
};

// ⚠️ Não altero o tipo global se seu projeto já define Request.user em outro lugar.
// Se NÃO houver outro augmentation, ative este bloco criando o .d.ts do passo 2.
// (Aqui, só exporto as funções.)
const DEBUG = env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "1";

function looksLikeJwt(t?: string | null): t is string {
  return !!t && typeof t === "string" && t.split(".").length === 3;
}

function normalizeRole(raw?: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (["admin", "administrator", "root"].includes(s)) return "admin";
  if (["finance", "finanças"].includes(s)) return "finance";
  if (["manager", "gestor"].includes(s)) return "manager";
  if (["partner", "parceiro"].includes(s)) return "partner";
  if (["user", "usuario", "customer", "cliente"].includes(s)) return "user";
  return s || "user";
}

function extractToken(req: Request): string | null {
  const rawAuth =
    (req.headers.authorization as string | undefined) ||
    ((req.headers as any).Authorization as string | undefined);
  if (rawAuth && typeof rawAuth === "string") {
    const trimmed = rawAuth.trim();
    const m = trimmed.match(/^Bearer\s+(.+)$/i);
    const maybe = (m ? m[1] : trimmed).trim();
    if (looksLikeJwt(maybe)) return maybe;
  }
  const ck = (req as any).cookies || {};
  const cookieKeys = ["token","auth_token_v1","auth_token","access_token","jwt","id_token","Authorization"];
  for (const k of cookieKeys) {
    const v = ck?.[k];
    if (looksLikeJwt(v)) return String(v);
  }
  const allowQuery =
    env.NODE_ENV !== "production" || process.env.DEBUG_AUTH_TOKEN === "1";
  if (allowQuery) {
    const q =
      (req.query.token as string | undefined) ||
      (req.query.Authorization as string | undefined) ||
      (req.query.auth as string | undefined) ||
      (req.query.access_token as string | undefined);
    if (q) {
      const cleaned = q.trim().replace(/^Bearer\s+/i, "");
      if (looksLikeJwt(cleaned)) return cleaned;
    }
  }
  return null;
}

/** Middleware obrigatório (401 se não tiver token válido) */
export function auth(requiredRole?: string) {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET ausente. Verifique seu .env e o loader em src/config/env.ts");
  }
  const want = String(requiredRole || "").trim().toLowerCase();

  return (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) {
      if (DEBUG) console.warn("[auth] token ausente (header/cookie/query)");
      return res.status(401).json({ message: "Unauthorized" });
    }
    let payload: JwtUser;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as JwtUser;
    } catch (e: any) {
      if (DEBUG) console.warn("[auth] invalid token:", e?.message);
      return res.status(401).json({ message: "Invalid token" });
    }
    const uid =
      payload?._id ??
      (payload as any)?.sub ??
      (payload as any)?.id ??
      (payload as any)?.userId ??
      (payload as any)?.user_id ??
      null;

    const role = normalizeRole(
      payload?.role ?? payload?.userType ?? (payload as any)?.user_type
    );

    // NÃO sobrescrevo req.user tipada globalmente; apenas anexo campo compatível.
    (req as any).user = { ...(req as any).user, ...payload, _id: uid ? String(uid) : "", role };

    if (requiredRole) {
      if (role === "admin" || role === want) return next();
      if (DEBUG) console.warn("[auth] forbidden: need", want, "have", role);
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

/** Middleware opcional (nunca lança) */
export function authOptional() {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = extractToken(req);
      if (!token) return next();

      if (!env.JWT_SECRET) {
        if (DEBUG) console.warn("[authOptional] JWT_SECRET ausente; seguindo sem verificar token");
        return next();
      }
      try {
        const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as JwtUser;
        const uid =
          payload?._id ??
          (payload as any)?.sub ??
          (payload as any)?.id ??
          (payload as any)?.userId ??
          (payload as any)?.user_id ??
          null;
        const role = normalizeRole(
          payload?.role ?? payload?.userType ?? (payload as any)?.user_type
        );
        (req as any).user = { ...(req as any).user, ...payload, _id: uid ? String(uid) : "", role };
      } catch (e: any) {
        if (DEBUG) console.warn("[authOptional] token inválido:", e?.message);
      }
    } catch {}
    next();
  };
}

// exports com sufixo para não confundir com o auth “antigo” ao importar
export const authV2 = auth;
export const authOptionalV2 = authOptional;
export type JwtUserV2 = JwtUser;

export default authV2;
