import { Router, type Request, type Response, type NextFunction } from "express";
import * as jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import User from "../users/user.model";
import { auth } from "../middleware/auth";
import { env } from "../config/env";

const router = Router();

/* ===== JWT ===== */
const JWT_SECRET: jwt.Secret = env.JWT_SECRET;
const JWT_EXPIRES_IN: jwt.SignOptions["expiresIn"] = (() => {
  const v = process.env.JWT_EXPIRES_IN;
  if (!v) return "7d";
  if (/^\d+$/.test(v)) return Number(v);
  return v as jwt.SignOptions["expiresIn"];
})();

/* ===== Helpers ===== */
const norm = (s?: string) => (s || "").toString().trim().toLowerCase();
const isObjectId = (id?: string) =>
  typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

const sanitize = (u: any) => {
  if (!u) return null;
  const obj = u.toObject ? u.toObject({ virtuals: true }) : u;
  const { password, __v, ...rest } = obj || {};
  return rest;
};

async function matches(input: string, stored?: string | null) {
  if (!stored) return false;
  if (/^\$2[aby]\$/.test(stored)) {
    try { return await bcrypt.compare(input, stored); } catch { return false; }
  }
  return input === stored; // legado
}

function readPw(body: any = {}) {
  const current =
    body.currentPassword ?? body.passwordCurrent ?? body.oldPassword ?? body.passwordOld ?? body.password;
  const next =
    body.newPassword ?? body.passwordNew ?? body.nextPassword ?? body.new ?? body.newpass;
  return { current: String(current ?? ""), next: String(next ?? "") };
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

    const userDoc = await User.findOne({
      $or: [
        { login: new RegExp(`^${userKey}$`, "i") },
        { email: new RegExp(`^${userKey}$`, "i") },
      ],
    }).select("+password"); // precisamos do hash

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

    const payload = {
      _id: String(userDoc._id),
      id: String(userDoc._id),
      email: userDoc.email,
      fullName: (userDoc as any).fullName || "",
      role: userDoc.role || "partner",
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: "HS256",
    });

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

/* ---------- POST /auth/logout ---------- */
router.post("/logout", (_req: Request, res: Response) => {
  try {
    res.clearCookie?.("token", { sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  } catch {}
  return res.json({ ok: true });
});

/* ---------- POST /auth/refresh ---------- */
/* Requer um token válido no Authorization: Bearer ou cookie; renova a expiração */
router.post("/refresh", auth(), async (req: Request, res: Response) => {
  try {
    const u = (req.user as any) || {};
    if (!u || !u.id) return res.status(401).json({ message: "Unauthorized" });

    const payload = {
      _id: String(u._id || u.id),
      id: String(u._id || u.id),
      email: u.email,
      fullName: u.fullName || "",
      role: u.role || "partner",
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: "HS256",
    });

    res.cookie?.("token", accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ ok: true, accessToken });
  } catch (err) {
    return res.status(500).json({ message: "Internal error" });
  }
});

/* ---------- GET /auth/me ---------- */
router.get("/me", auth(), async (req: Request, res: Response) => {
  try {
    const id = (req.user as any)?._id || (req.user as any)?.id;
    if (!id || !isObjectId(id)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Busca documento completo com virtuals (*YMD)
    const fresh = await User.findById(id).select("+_id");
    if (!fresh) return res.status(404).json({ message: "User not found" });

    return res.json({ ok: true, user: sanitize(fresh) });
  } catch (err) {
    console.error("auth.me error:", err);
    return res.status(500).json({ message: "Internal error" });
  }
});

/* ---------- POST /auth/change-password ---------- */
router.post("/change-password", auth(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.user;
    const userId = (me as any)?._id && isObjectId((me as any)._id) ? String((me as any)._id) : null;
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
