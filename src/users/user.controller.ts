// src/users/user.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import UserModel from "./user.model";
import { CreateUserSchema, UpdateUserSchema, ListQuerySchema } from "./user.schemas";

// Campos mínimos que o front precisa (reduz payload e CPU)
const LIST_FIELDS = {
  fullName: 1,
  email: 1,
  login: 1,
  role: 1,
  funcao: 1,
  team: 1,
  status: 1,
  avatarUrl: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

// Limites de paginação (proteção e performance)
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

function toSafe<T extends Record<string, any>>(u: T) {
  if (!u) return u as any;
  // segurança extra; normalmente estes campos já não vêm pela projeção
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, __v, ...safe } = u;
  return safe;
}

// LISTAGEM OTIMIZADA
export async function listUsers(req: Request, res: Response) {
  try {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid query" });

    let { q, role, page, pageSize } = parsed.data;

    // includeTotal=0|false|no => pula o count
    const incFlag = String(req.query.includeTotal ?? "1").toLowerCase();
    const includeTotal = !(incFlag === "0" || incFlag === "false" || incFlag === "no");

    page = Math.max(1, Number(page) || 1);
    pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));

    const filter: any = {};
    if (role) filter.role = role;

    let useText = false;
    if (q && q.trim().length >= 2) {
      // Usa índice de texto (definido no model) — mais rápido e ordenável por score
      filter.$text = { $search: q.trim() };
      useText = true;
    } else if (q) {
      // Para consultas de 1 char, usa regex leve
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

    // Ordenação: por score (se $text) + createdAt desc
    const sort: any = useText
      ? { score: { $meta: "textScore" }, createdAt: -1 }
      : { createdAt: -1 };

    // Projeção: apenas campos essenciais (+ score quando $text)
    const projection: any = useText
      ? { ...LIST_FIELDS, score: { $meta: "textScore" } }
      : LIST_FIELDS;

    // Monta query
    let query = UserModel.find(filter)
      .select(projection)
      .sort(sort)
      .skip(skip)
      .limit(pageSize)
      .lean();

    // Preferência de leitura em secundária (se habilitado por env)
    if (process.env.READ_SECONDARY === "1") {
      query = query.read("secondaryPreferred");
    }

    // Dicas de índice para o planner quando NÃO é $text
    if (!useText && role) query = query.hint({ role: 1, createdAt: -1 });
    if (!useText && !role && !q) query = query.hint({ createdAt: -1 });

    const listPromise = query.exec();
    const countPromise = includeTotal
      ? (q || role
          ? UserModel.countDocuments(filter).exec()
          : UserModel.estimatedDocumentCount().exec())
      : Promise.resolve(undefined);

    const [docs, total] = await Promise.all([listPromise, countPromise]);

    // Remove score do payload de saída
    const items = (docs as any[]).map(({ score, ...rest }) => toSafe(rest));

    const payload: any = { items, page, pageSize };
    if (includeTotal) payload.total = total;

    res.json(payload);
  } catch (err: any) {
    console.error("[users:list] error:", err);
    res.status(500).json({ error: "internal error" });
  }
}

export async function createUser(req: Request, res: Response) {
  try {
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid body" });

    const { email, login, password, ...rest } = parsed.data;

    // Checagem otimista
    const exists = await UserModel.exists({ $or: [{ email }, { login }] });
    if (exists) return res.status(409).json({ error: "email or login already in use" });

    const hash = await bcrypt.hash(password, 10);
    const doc = await UserModel.create({
      email: email.toLowerCase().trim(),
      login: login.toLowerCase().trim(),
      password: hash,
      ...rest,
    });

    res.status(201).json(toSafe(doc.toObject()));
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: "email or login already in use" });
    }
    console.error("[users:create] error:", err);
    res.status(500).json({ error: "internal error" });
  }
}

export async function updateUser(req: Request, res: Response) {
  try {
    const id = req.params.id;
    const parsed = UpdateUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid body" });

    const payload: any = { ...parsed.data };

    if (payload.email) payload.email = String(payload.email).toLowerCase().trim();
    if (payload.login) payload.login = String(payload.login).toLowerCase().trim();

    if (payload.email || payload.login) {
      const or: any[] = [];
      if (payload.email) or.push({ email: payload.email });
      if (payload.login) or.push({ login: payload.login });
      if (or.length) {
        const conflict = await UserModel.findOne({ $or: or, _id: { $ne: id } })
          .select("_id")
          .lean();
        if (conflict) return res.status(409).json({ error: "email or login already in use" });
      }
    }

    if (payload.password) {
      // Também será hasheado no hook do model, mas fazemos aqui para não trafegar senha pura
      payload.password = await bcrypt.hash(payload.password, 10);
    }

    const updated = await UserModel.findByIdAndUpdate(
      id,
      payload,
      { new: true, runValidators: true, projection: LIST_FIELDS }
    ).lean();

    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(toSafe(updated));
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: "email or login already in use" });
    }
    console.error("[users:update] error:", err);
    res.status(500).json({ error: "internal error" });
  }
}

export async function deleteUser(req: Request, res: Response) {
  try {
    const id = req.params.id;
    const deleted = await UserModel.findByIdAndDelete(id).select("_id").lean();
    if (!deleted) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[users:delete] error:", err);
    res.status(500).json({ error: "internal error" });
  }
}
