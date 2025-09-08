// src/dev/debug.routes.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

const r = Router();

/** Confirma qual SECRET o app carregou */
r.get("/dev/env-check", (_req, res) => {
  const sec = env.JWT_SECRET || "";
  res.json({
    ok: true,
    NODE_ENV: env.NODE_ENV,
    jwtSecretPrefix: sec ? sec.slice(0, 12) : null,
    jwtSecretLen: sec ? sec.length : 0,
  });
});

/** Lê e decodifica o token do mesmo jeito do middleware */
function extractToken(req: any): string | null {
  const h = (req.headers.authorization || req.headers.Authorization || "").trim();
  if (h) {
    const m = h.match(/^Bearer\s+(.+)$/i);
    const t = m ? m[1].trim() : h;
    if (t.split(".").length === 3) return t;
  }
  const ck = req.cookies || {};
  const c =
    ck.auth_token_v1 || ck.token || ck.access_token || ck.Authorization || null;
  if (c && String(c).split(".").length === 3) return String(c);

  const q =
    (req.query.token as string) ||
    (req.query.Authorization as string) ||
    (req.query.auth as string) ||
    (req.query.access_token as string) ||
    "";
  if (q) {
    const t = q.replace(/^Bearer\s+/i, "").trim();
    if (t.split(".").length === 3) return t;
  }
  return null;
}

/** Verifica o token recebido exatamente como o middleware faria */
r.get("/dev/jwt-info", (req, res) => {
  const token = extractToken(req);
  if (!token) return res.status(400).json({ ok: false, error: "no_token" });

  const alg = "HS256";
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [alg] });
    return res.json({ ok: true, algorithms: [alg], payload });
  } catch (e: any) {
    return res.status(401).json({
      ok: false,
      error: "verify_failed",
      message: e?.message || String(e),
    });
  }
});

export default r;
