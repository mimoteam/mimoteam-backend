// src/users/user.routes.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "./user.model";
import { uploadAvatarMulter } from "../middleware/uploadAvatar";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

/* ========= Utils ========= */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isObjectId = (id?: string) =>
  typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

const toInt = (v: unknown, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/** Normaliza payload de datas para compat com o frontend (FinanceProfile) */
function normalizePatch(body: any = {}) {
  const patch: any = { ...body };

  // DOB
  if (body.dob !== undefined || body.birthday !== undefined) {
    const v = body.dob ?? body.birthday ?? "";
    patch.birthday = v === "" ? null : v;
    delete patch.dob;
  }

  // Start/Hire Date
  if (
    body.hireDate !== undefined ||
    body.startDate !== undefined ||
    body.companyStartDate !== undefined
  ) {
    const v = body.hireDate ?? body.startDate ?? body.companyStartDate ?? "";
    const val = v === "" ? null : v;
    patch.hireDate = val;
    patch.startDate = val;
    patch.companyStartDate = val;
  }

  // nunca permita trocar _id via update
  delete patch._id;
  delete patch.id;

  return patch;
}

/* helpers p/ senha */
function readPw(body: any = {}) {
  const current =
    body.currentPassword ??
    body.passwordCurrent ??
    body.oldPassword ??
    body.passwordOld ??
    body.password;

  const next =
    body.newPassword ??
    body.passwordNew ??
    body.nextPassword ??
    body.new ??
    body.newpass;

  return { current: String(current ?? ""), next: String(next ?? "") };
}
function getUserIdFromReq(req: Request): string | null {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const id = String(payload?.sub || payload?.id || "");
    return mongoose.Types.ObjectId.isValid(id) ? id : null;
  } catch {
    return null;
  }
}

/* =========================
   GET /users
   ========================= */
type ListQuery = {
  role?: string;
  status?: string;
  page?: string | number;
  pageSize?: string | number;
  limit?: string | number;
  offset?: string | number;
  q?: string;
};

router.get(
  "/",
  async (
    req: Request<unknown, unknown, unknown, ListQuery>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { role, status, page, pageSize, limit, offset, q } = req.query;

      const pageNum = toInt(
        page ?? (offset ? Math.floor(toInt(offset, 0) / toInt(limit ?? 10, 10)) + 1 : 1),
        1
      );
      const pageSizeNum = toInt(pageSize ?? limit ?? 10, 10);
      const skip = (pageNum - 1) * pageSizeNum;

      const filter: any = {};
      if (role) {
        filter.role = { $regex: new RegExp(`^${escapeRegExp(String(role))}$`, "i") };
      }
      if (status) {
        filter.status = { $regex: new RegExp(`^${escapeRegExp(String(status))}$`, "i") };
      }
      if (q) {
        const rx = new RegExp(String(q), "i");
        filter.$or = [{ fullName: rx }, { login: rx }, { email: rx }];
      }

      const [items, total] = await Promise.all([
        User.find(filter).skip(skip).limit(pageSizeNum).lean(),
        User.countDocuments(filter),
      ]);

      res.json({
        items,
        total,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.max(1, Math.ceil(total / pageSizeNum)),
      });
    } catch (err) {
      next(err);
    }
  }
);

/* =========================
   POST /users
   ========================= */
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const created = await User.create(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

/* =========================
   UPDATEs (corrigem os 404)
   ========================= */

// PATCH/PUT/POST (legado) /users/:id
async function updateById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params as { id: string };
    if (!isObjectId(id)) return res.status(400).json({ error: "Invalid id" });

    const patch = normalizePatch(req.body);
    const updated = await User.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });

    // retorna objeto plano (frontend faz merge direto)
    return res.json(updated);
  } catch (err) {
    next(err);
  }
}
router.patch("/:id", updateById);
router.put("/:id", updateById);
// alguns clientes antigos usam POST para update
router.post("/:id", updateById);

// PATCH/PUT /users  (id no body)
async function updateCollection(req: Request, res: Response, next: NextFunction) {
  try {
    const id = (req.body?._id || req.body?.id) as string | undefined;
    if (!isObjectId(id)) return res.status(400).json({ error: "Missing valid id in body" });

    const patch = normalizePatch(req.body);
    const updated = await User.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });

    return res.json(updated);
  } catch (err) {
    next(err);
  }
}
router.patch("/", updateCollection);
router.put("/", updateCollection);

// PATCH/PUT /users/me (quando o cliente atualiza o próprio registro)
async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    // sem middleware de auth, tentamos header/cookie/req.user
    const uid =
      (req as any).user?._id ||
      (req as any).user?.id ||
      (req as any).userId ||
      (req.headers["x-user-id"] as string | undefined) ||
      ((req as any).cookies && (req as any).cookies.uid) ||
      getUserIdFromReq(req);

    if (!isObjectId(String(uid))) return res.status(401).json({ error: "Unauthorized" });

    const patch = normalizePatch(req.body);
    const updated = await User.findByIdAndUpdate(uid, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });

    return res.json(updated);
  } catch (err) {
    next(err);
  }
}
router.patch("/me", updateMe);
router.put("/me", updateMe);

/* =========================
   Troca de senha (compat com frontend)
   ========================= */
// POST /users/:id/password
router.post("/:id/password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    if (!isObjectId(id)) return res.status(400).json({ message: "Invalid id" });

    const { current, next } = readPw(req.body);
    if (!next) return res.status(400).json({ message: "Missing new password" });
    if (next.length < 6) return res.status(400).json({ message: "Password too short" });

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const stored = String(user.password || "");
    const ok = stored.startsWith("$2") ? await bcrypt.compare(current || "", stored) : current === stored;
    if (!ok) return res.status(401).json({ message: "Invalid current password" });

    user.password = await bcrypt.hash(next, 10);
    await user.save();
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /users/me/password
router.post("/me/password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authId = getUserIdFromReq(req);
    if (!authId) return res.status(401).json({ message: "Unauthorized" });

    const { current, next } = readPw(req.body);
    if (!next) return res.status(400).json({ message: "Missing new password" });
    if (next.length < 6) return res.status(400).json({ message: "Password too short" });

    const user = await User.findById(authId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const stored = String(user.password || "");
    const ok = stored.startsWith("$2") ? await bcrypt.compare(current || "", stored) : current === stored;
    if (!ok) return res.status(401).json({ message: "Invalid current password" });

    user.password = await bcrypt.hash(next, 10);
    await user.save();
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* =========================
   Avatar upload
   ========================= */
router.post(
  "/:id/avatar",
  uploadAvatarMulter.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      if (!isObjectId(id)) {
        return res.status(400).json({ error: "Invalid id" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const publicPath = `/uploads/avatars/${req.file.filename}`;
      const updated = await User.findByIdAndUpdate(
        id,
        { avatarUrl: publicPath },
        { new: true }
      ).lean();
      if (!updated) return res.status(404).json({ error: "Not found" });
      return res.status(201).json({ url: publicPath, avatarUrl: publicPath, user: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* =========================
   DELETE /users/:id
   ========================= */
router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params as { id: string };
    if (!isObjectId(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const deleted = await User.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
