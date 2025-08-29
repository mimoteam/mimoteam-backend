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
}

const userSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    login: { type: String, required: true, trim: true, lowercase: true, unique: true },
    // IMPORTANTE: select:false -> login deve fazer .select("+password")
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "partner", "finance"], default: "partner", required: true },
    funcao: { type: String },
    team: { type: String },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    avatarUrl: { type: String, default: null },
    birthday: { type: Date, default: null },
    hireDate: { type: Date, default: null },
    startDate: { type: Date, default: null },
    companyStartDate: { type: Date, default: null },
    department: { type: String },
  },
  { timestamps: true }
);

// remove password/__v em JSON/Object
function strip(ret: any) {
  const { password, __v, ...rest } = ret || {};
  return rest;
}
userSchema.set("toJSON", { virtuals: true, transform: (_d, r) => strip(r) });
userSchema.set("toObject", { virtuals: true, transform: (_d, r) => strip(r) });

// hash automático quando o password for modificado
userSchema.pre("save", async function (next) {
  const doc = this as any;
  if (doc.isModified("password")) {
    const pwd = String(doc.password || "");
    if (!pwd.startsWith("$2")) {
      doc.password = await bcrypt.hash(pwd, 10);
    }
  }
  next();
});

userSchema.pre("findOneAndUpdate", async function (next) {
  const upd: any = this.getUpdate() || {};
  const pwd = upd.password ?? upd.$set?.password;
  if (pwd) {
    const raw = String(pwd);
    if (!raw.startsWith("$2")) {
      const hashed = await bcrypt.hash(raw, 10);
      if (upd.password) upd.password = hashed;
      if (upd.$set?.password) upd.$set.password = hashed;
      this.setUpdate(upd);
    }
  }
  next();
});

const UserModel: Model<IUser> = (models.User as Model<IUser>) || model<IUser>("User", userSchema);
export default UserModel;
export { UserModel };
