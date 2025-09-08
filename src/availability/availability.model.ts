// src/availability/availability.model.ts
import mongoose, { Schema, Types, Model } from "mongoose";

export type AvailState = "busy" | "unavailable";
export type AvailActor = "admin" | "partner" | "unknown";

export interface IAvailability {
  partnerId: any;          // ObjectId ou string (legado)
  partnerKey: string;      // SEMPRE string normalizada (hex de ObjectId ou a própria string)
  date: string;            // "YYYY-MM-DD" (tempo local)
  state: AvailState;
  by?: AvailActor;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AvailabilityModel extends Model<IAvailability> {
  findRange(pid: string, from: string, to: string): Promise<Pick<IAvailability,"date"|"state"|"by">[]>;
}

const AvailabilitySchema = new Schema<IAvailability, AvailabilityModel>(
  {
    partnerId: { type: Schema.Types.Mixed, required: true, index: true },
    partnerKey: { type: String, required: true, index: true }, // 🔑 normalizado
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"],
      index: true,
    },
    state: { type: String, enum: ["busy", "unavailable"], required: true },
    by: { type: String, enum: ["admin", "partner", "unknown"], default: "partner" },
  },
  { timestamps: true }
);

// Índice único “canônico” para novos writes
AvailabilitySchema.index({ partnerKey: 1, date: 1 }, { unique: true });
// Mantém índice antigo (não único) por compat
AvailabilitySchema.index({ partnerId: 1, date: 1 });

/* ===== Helpers ===== */
function mkPartnerKey(val: any): string {
  const s = String(val || "");
  return Types.ObjectId.isValid(s) ? String(new Types.ObjectId(s)) : s;
}

// Garante partnerKey sempre setado
AvailabilitySchema.pre("save", function (next) {
  (this as any).partnerKey = mkPartnerKey((this as any).partnerId);
  next();
});

AvailabilitySchema.statics.findRange = function (pid: string, from: string, to: string) {
  const key = mkPartnerKey(pid);
  const candidates: any[] = [pid];
  if (Types.ObjectId.isValid(pid)) candidates.push(new Types.ObjectId(pid));

  return this.find(
    {
      date: { $gte: from, $lte: to },
      $or: [{ partnerKey: key }, { partnerId: { $in: candidates } }],
    },
    { _id: 0, date: 1, state: 1, by: 1 }
  )
    .sort({ date: 1 })
    .lean()
    .exec();
};

export const Availability =
  (mongoose.models.Availability as AvailabilityModel) ??
  mongoose.model<IAvailability, AvailabilityModel>("Availability", AvailabilitySchema);

export default Availability;
