// src/users/user.controller.ts
import UserModel from "./user.model"; 
import { CreateUserSchema, UpdateUserSchema, ListQuerySchema } from './user.schemas';
import { Request, Response } from "express";
import bcrypt from "bcryptjs";

function toSafe(u: any) {
  if (!u) return u;
  const { password, __v, ...safe } = u;
  return safe;
}

export async function listUsers(req: Request, res: Response) {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "invalid query" });

  const { q, role, page, pageSize } = parsed.data;
  const filter: any = {};
  if (role) filter.role = role;
  if (q) {
    const rx = new RegExp(q, "i");
    filter.$or = [
      { fullName: rx },
      { email: rx },
      { login: rx },
      { funcao: rx },
      { team: rx },
    ];
  }

  const skip = (page - 1) * pageSize;
  const [items, total] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    UserModel.countDocuments(filter),
  ]);

  res.json({
    items: items.map(toSafe),
    total,
    page,
    pageSize,
  });
}

export async function createUser(req: Request, res: Response) {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const { email, login, password, ...rest } = parsed.data;

  const exists = await UserModel.exists({ $or: [{ email }, { login }] });
  if (exists) return res.status(409).json({ error: "email or login already in use" });

  const hash = await bcrypt.hash(password, 10);
  const doc = await UserModel.create({
    email,
    login,
    password: hash,
    ...rest,
  });

  res.status(201).json(toSafe(doc.toObject()));
}

export async function updateUser(req: Request, res: Response) {
  const id = req.params.id;
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const payload: any = { ...parsed.data };

  if (payload.email || payload.login) {
    const or: any[] = [];
    if (payload.email) or.push({ email: payload.email });
    if (payload.login) or.push({ login: payload.login });
    if (or.length) {
      const conflict = await UserModel.findOne({ $or: or, _id: { $ne: id } }).lean();
      if (conflict) return res.status(409).json({ error: "email or login already in use" });
    }
  }

  if (payload.password) {
    payload.password = await bcrypt.hash(payload.password, 10);
  }

  const updated = await UserModel.findByIdAndUpdate(id, payload, { new: true }).lean();
  if (!updated) return res.status(404).json({ error: "not found" });

  res.json(toSafe(updated));
}

export async function deleteUser(req: Request, res: Response) {
  const id = req.params.id;
  const deleted = await UserModel.findByIdAndDelete(id).lean();
  if (!deleted) return res.status(404).json({ error: "not found" });
  res.json({ ok: true });
}
