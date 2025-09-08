// backend/src/auth/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import UserModel from "../users/user.model";
import { signJwt } from "./auth.service";

const normalize = (v?: string) => (v || "").toString().trim().toLowerCase();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

/** Extrai o userId do Authorization: Bearer <token> */
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

export async function login(req: Request, res: Response) {
  try {
    // aceita { login, password } e aliases comuns
    const { login, user, email, username, password } = (req.body || {}) as any;
    const identifier = normalize(login ?? user ?? email ?? username);
    if (!identifier || !password) {
      return res.status(400).json({ error: "Missing login/password" });
    }

    // importante: selecione o campo de senha (hash) se for select:false no schema
    const dbUser = await UserModel.findOne({
      $or: [{ login: identifier }, { email: identifier }, { username: identifier }],
    })
      .select("+password") // se no schema o campo fosse passwordHash, trocar aqui
      .lean(false); // queremos o Document para usar toJSON com virtuals

    if (!dbUser) return res.status(401).json({ error: "Invalid credentials" });
    if ((dbUser as any).status && (dbUser as any).status !== "active") {
      return res.status(403).json({ error: "User disabled" });
    }

    // compare com o hash salvo
    const ok = await bcrypt.compare(password, (dbUser as any).password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signJwt({ sub: dbUser._id.toString(), role: (dbUser as any).role });

    // Serializa com virtuals (inclui birthdayYMD, hireDateYMD, etc.)
    const json = dbUser.toJSON({ virtuals: true }) as any;
    // Remover quaisquer vestígios de password
    delete json.password;

    // Mantém compat + acrescenta avatar e datas (não quebra o front atual)
    const safeUser = {
      id: dbUser._id.toString(),
      fullName: json.fullName,
      email: json.email,
      login: json.login,
      role: json.role,
      status: json.status,
      team: json.team,
      funcao: json.funcao,
      department: json.department ?? undefined,
      avatarUrl: json.avatarUrl ?? null,

      // Datas em Date (ISO) e virtuais YYYY-MM-DD (seus componentes já usam)
      birthday: json.birthday ?? null,
      birthdayYMD: json.birthdayYMD ?? null,
      hireDate: json.hireDate ?? null,
      hireDateYMD: json.hireDateYMD ?? null,
      startDate: json.startDate ?? null,
      startDateYMD: json.startDateYMD ?? null,
      companyStartDate: json.companyStartDate ?? null,
      companyStartDateYMD: json.companyStartDateYMD ?? null,

      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
    };

    return res.json({ token, user: safeUser });
  } catch (err) {
    console.error("auth.login error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

/**
 * GET /auth/me
 * Retorna o usuário logado COMPLETO (com virtuals *YMD)
 */
export async function me(req: Request, res: Response) {
  try {
    const uid =
      (req as any).user?._id ||
      (req as any).user?.id ||
      (req as any).userId ||
      (req.headers["x-user-id"] as string | undefined) ||
      getUserIdFromReq(req);

    if (!uid || !mongoose.Types.ObjectId.isValid(String(uid))) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Usar Document (sem lean) para aplicar toJSON com virtuals
    const doc = await UserModel.findById(uid).select("+_id");
    if (!doc) return res.status(404).json({ error: "Not found" });

    const json = doc.toJSON({ virtuals: true }) as any;
    delete json.password;

    // opcional: garantir id string no payload
    json.id = String(json._id || uid);

    return res.json({ user: json });
  } catch (err) {
    console.error("auth.me error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

// rota de seed só fora de produção
export async function devSeed(_req: Request, res: Response) {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "forbidden" });
    }

    const users = [
      {
        fullName: "Admin User",
        email: "admin@mimo.com",
        login: "admin",
        password: await bcrypt.hash("admin123", 10), // hash salvo em "password"
        role: "admin",
        funcao: "GUIDE",
        team: "US Team",
        status: "active",
      },
      {
        fullName: "Partner User",
        email: "partner@mimo.com",
        login: "partner",
        password: await bcrypt.hash("partner123", 10),
        role: "partner",
        funcao: "CONCIERGE",
        team: "Brazil Team",
        status: "active",
      },
      {
        fullName: "Finance User",
        email: "finance@mimo.com",
        login: "finance",
        password: await bcrypt.hash("finance123", 10),
        role: "finance",
        funcao: "THIRD-PARTY",
        team: "US Team",
        status: "active",
      },
    ];

    const seeded: string[] = [];
    for (const u of users) {
      await UserModel.updateOne({ login: u.login }, { $setOnInsert: u }, { upsert: true });
      seeded.push(u.login);
    }
    return res.json({ ok: true, seeded });
  } catch (e) {
    console.error("devSeed error:", e);
    return res.status(500).json({ error: "seed failed" });
  }
}
