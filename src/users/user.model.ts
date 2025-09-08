// src/users/user.model.ts
import { Schema, model, models, type Document, type Model, Types } from "mongoose";
import bcrypt from "bcryptjs";

export type Role = "admin" | "partner" | "finance";

export interface IUser extends Document {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  login: string;
  password: string;
  role: Role;
  funcao?: string;
  team?: string;
  status: "active" | "inactive";
  avatarUrl?: string | null;
  birthday?: Date | null;
  hireDate?: Date | null;
  startDate?: Date | null;
  companyStartDate?: Date | null;
  department?: string;
  createdAt: Date;
  updatedAt: Date;

  // Virtuais (expostos via toJSON/toObject com virtuals: true)
  // Não precisam estar no TypeScript, mas não atrapalha declarar:
  // birthdayYMD?: string | null;
  // hireDateYMD?: string | null;
  // startDateYMD?: string | null;
  // companyStartDateYMD?: string | null;
}

const userSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true },
    email:    { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    login:    { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    // IMPORTANTE: select:false -> login deve fazer .select("+password") quando necessário
    password: { type: String, required: true, select: false },
    role:     { type: String, enum: ["admin", "partner", "finance"], default: "partner", required: true },
    funcao:   { type: String },
    team:     { type: String },
    status:   { type: String, enum: ["active", "inactive"], default: "active" },
    avatarUrl:        { type: String, default: null },
    birthday:         { type: Date,   default: null },
    hireDate:         { type: Date,   default: null },
    startDate:        { type: Date,   default: null },
    companyStartDate: { type: Date,   default: null },
    department:       { type: String },
  },
  { timestamps: true }
);

/* ── Índices úteis ─────────────────────────────────────────────── */
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ status: 1, createdAt: -1 });

// Busca full-text pra q=
userSchema.index(
  { fullName: "text", email: "text", login: "text", funcao: "text", team: "text" },
  { name: "user_text_search", weights: { fullName: 5, email: 4, login: 4, funcao: 2, team: 1 } }
);

/* ── Saída segura (remove password/__v) ───────────────────────── */
function strip(ret: any) {
  const { password, __v, ...rest } = ret || {};
  return rest;
}
userSchema.set("toJSON",   { virtuals: true, transform: (_d, r) => strip(r) });
userSchema.set("toObject", { virtuals: true, transform: (_d, r) => strip(r) });

/* ── Helpers internos ─────────────────────────────────────────── */
async function ensureHashed(raw: string) {
  if (!raw || raw.startsWith("$2")) return raw;
  return bcrypt.hash(raw, 10);
}
function normalizeStr(v?: unknown) {
  return typeof v === "string" ? v.trim().toLowerCase() : v;
}

/* ── Helpers de data (para virtuais YYYY-MM-DD) ───────────────── */
function dateToYMD(d?: Date | null) {
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function ymdToDate(ymd?: string | null) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  // Usa UTC para evitar drift de timezone
  return new Date(`${ymd}T00:00:00.000Z`);
}

/* ── Virtuais YYYY-MM-DD (somente formatação/conveniência) ───── */
userSchema.virtual("birthdayYMD").get(function (this: IUser) {
  return dateToYMD(this.birthday ?? null);
});
userSchema.virtual("hireDateYMD").get(function (this: IUser) {
  return dateToYMD(this.hireDate ?? null);
});
userSchema.virtual("startDateYMD").get(function (this: IUser) {
  return dateToYMD(this.startDate ?? null);
});
userSchema.virtual("companyStartDateYMD").get(function (this: IUser) {
  return dateToYMD(this.companyStartDate ?? null);
});

// Setters opcionais (permitem aceitar *_YMD caso algum cliente envie esses nomes)
userSchema.virtual("birthdayYMD").set(function (this: any, v: string) {
  this.birthday = ymdToDate(v);
});
userSchema.virtual("hireDateYMD").set(function (this: any, v: string) {
  this.hireDate = ymdToDate(v);
});
userSchema.virtual("startDateYMD").set(function (this: any, v: string) {
  this.startDate = ymdToDate(v);
});
userSchema.virtual("companyStartDateYMD").set(function (this: any, v: string) {
  this.companyStartDate = ymdToDate(v);
});

/* ── save: hash e normalização ─────────────────────────────────── */
userSchema.pre("save", async function (next) {
  const doc = this as any;

  if (doc.isModified("password")) {
    doc.password = await ensureHashed(String(doc.password || ""));
  }
  if (doc.isModified("email")) doc.email = normalizeStr(doc.email);
  if (doc.isModified("login")) doc.login = normalizeStr(doc.login);

  next();
});

/* ── updateOne / updateMany / findOneAndUpdate: hash + normalize ─ */
userSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], async function (next) {
  const upd: any = this.getUpdate() || {};
  const set = upd.$set ?? upd;

  if (set?.email) set.email = normalizeStr(set.email);
  if (set?.login) set.login = normalizeStr(set.login);

  const pwd = set?.password ?? upd.password;
  if (pwd) {
    const hashed = await ensureHashed(String(pwd));
    if (upd.password)  upd.password = hashed;
    if (set?.password) set.password = hashed;
  }

  if (upd.$set) upd.$set = set;
  this.setUpdate(upd);
  next();
});

/* ── insertMany: hash/normalize em bulk imports ────────────────── */
userSchema.pre("insertMany", async function (next, docs: any[]) {
  if (!Array.isArray(docs)) return next();
  await Promise.all(
    docs.map(async (d) => {
      if (d.email) d.email = normalizeStr(d.email);
      if (d.login) d.login = normalizeStr(d.login);
      if (d.password) d.password = await ensureHashed(String(d.password));
      // Se vierem *_YMD nesses imports, aceita também:
      if (d.birthdayYMD && !d.birthday) d.birthday = ymdToDate(String(d.birthdayYMD));
      if (d.hireDateYMD && !d.hireDate) d.hireDate = ymdToDate(String(d.hireDateYMD));
      if (d.startDateYMD && !d.startDate) d.startDate = ymdToDate(String(d.startDateYMD));
      if (d.companyStartDateYMD && !d.companyStartDate) d.companyStartDate = ymdToDate(String(d.companyStartDateYMD));
    })
  );
  next();
});

const UserModel: Model<IUser> = (models.User as Model<IUser>) || model<IUser>("User", userSchema);
export default UserModel;
export { UserModel };
