// src/auth/auth.routes.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../users/user.model";

const router = Router();

/* ===== JWT ===== */
const JWT_SECRET: jwt.Secret = (process.env.JWT_SECRET ?? "dev-secret");
const JWT_EXPIRES_IN: jwt.SignOptions["expiresIn"] = (() => {
  const v = process.env.JWT_EXPIRES_IN;
  if (!v) return "7d";
  if (/^\d+$/.test(v)) return Number(v);
  return v as jwt.SignOptions["expiresIn"];
})();

/* ===== Utils ===== */
const norm = (s?: string) => (s || "").toString().trim().toLowerCase();
const isObjectId = (id?: string) =>
  typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

const sanitize = (u: any) => {
  const obj = u?.toObject ? u.toObject() : u;
  const { password, __v, ...rest } = obj || {};
  return rest;
};

async function matches(input: string, stored?: string | null) {
  if (!stored) return false;
  if (/^\$2[aby]\$/.test(stored)) {
    try { return await bcrypt.compare(input, stored); } catch { return false; }
  }
  return input === stored; // legado (texto puro)
}

function readPw(body: any = {}) {
  const current =
    body.currentPassword ?? body.passwordCurrent ?? body.oldPassword ?? body.passwordOld ?? body.password;
  const next =
    body.newPassword ?? body.passwordNew ?? body.nextPassword ?? body.new ?? body.newpass;
  return { current: String(current ?? ""), next: String(next ?? "") };
}

function tokenFromReq(req: Request): string | null {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookieTok = (req as any).cookies?.token as string | undefined;
  return bearer || cookieTok || null;
}

function userIdFromReq(req: Request): string | null {
  const tok = tokenFromReq(req);
  if (!tok) return null;
  try {
    const payload = jwt.verify(tok, JWT_SECRET) as jwt.JwtPayload | string;
    const id = typeof payload === "string" ? "" : String(payload?.sub ?? (payload as any)?.id ?? "");
    return isObjectId(id) ? id : null;
  } catch {
    return null;
  }
}

/* ---------- POST /auth/login ---------- */
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { login, username, email, password } = req.body || {};
    const userKey = norm(login || username || email);
    const pwd = String(password || "");
    if (!userKey || !pwd) {
      return res.status(400).json({ message: "login/email and password are required" });
    }

    // precisa do DOC real e com password selecionado
    const userDoc = await User.findOne({
      $or: [
        { login: new RegExp(`^${userKey}$`, "i") },
        { email: new RegExp(`^${userKey}$`, "i") },
      ],
    })
      .select("+password"); // <-- ESSENCIAL

    if (!userDoc) return res.status(401).json({ message: "Invalid credentials" });

    const stored = String(userDoc.password || "");
    let ok = false;

    if (stored.startsWith("$2")) {
      ok = await bcrypt.compare(pwd, stored);
    } else {
      ok = stored === pwd;
      if (ok) {
        userDoc.password = await bcrypt.hash(pwd, 10);
        await userDoc.save();
      }
    }

    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { sub: String(userDoc._id), id: String(userDoc._id), role: userDoc.role || "partner" },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // cookie opcional como fallback
    res.cookie?.("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ token, user: sanitize(userDoc) });
  } catch (err) {
    next(err);
  }
});

/* ---------- GET /auth/me ---------- */
router.get("/me", async (req: Request, res: Response) => {
  try {
    const tok = tokenFromReq(req);
    if (!tok) return res.status(401).json({ message: "Missing token" });

    const payload = jwt.verify(tok, JWT_SECRET) as jwt.JwtPayload | string;
    const id = typeof payload === "string" ? "" : String(payload?.sub || (payload as any)?.id || "");
    if (!isObjectId(id)) return res.status(401).json({ message: "Invalid token payload" });

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ user: sanitize(user) });
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
});

/* ---------- POST /auth/change-password ---------- */
router.post("/change-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearerId = userIdFromReq(req);
    const explicitId = (req.body?.userId || req.body?.id) as string | undefined;
    const userId = bearerId || (isObjectId(explicitId) ? explicitId : null);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { current, next } = readPw(req.body);
    if (!next) return res.status(400).json({ message: "Missing new password" });
    if (next.length < 6) return res.status(400).json({ message: "Password too short" });

    const user = await User.findById(userId).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const stored = String(user.password || "");
    const ok = !stored ? true : await matches(current || "", stored);
    if (!ok) return res.status(401).json({ message: "Invalid current password" });

    user.password = await bcrypt.hash(next, 10);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
