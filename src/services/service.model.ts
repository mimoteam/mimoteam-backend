import { Schema, model, type Document } from "mongoose";

/* =========================
 * Tipos auxiliares
 * ========================= */
interface IServiceType {
  id: string;
  name?: string;
}
interface IPartnerRef {
  id: string;
  name?: string;
  email?: string;
}

export interface IService extends Document {
  serviceDate: Date;
  firstName?: string;
  lastName?: string;
  clientName?: string;
  park?: string;
  location?: string;
  guests?: number | null;
  hopper?: boolean;
  team?: string;
  finalValue: number;

  serviceType?: IServiceType | null;
  serviceTypeId?: string;

  partnerId?: string;
  partner?: IPartnerRef | null;

  serviceTime?: number | null;
  observations?: string;
  overrideValue?: number | null;
  calculatedPrice?: any | null;
  status?: string;

  createdAt: Date;
  updatedAt: Date;
}

/* =========================
 * Helpers
 * ========================= */
function properCase(s: string) {
  const v = (s ?? "").trim().toLowerCase();
  // Primeira letra de cada palavra maiúscula, restante minúscula
  return v.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function normalizeStatus(v?: string): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "pending";
  if (["waiting to approve", "waiting for approval", "shared", "waiting"].includes(s)) return "waiting to approve";
  if (["denied", "rejected", "recusado"].includes(s)) return "denied";
  if (["paid", "pago"].includes(s)) return "paid";
  if (["pending", "pendente"].includes(s)) return "pending";
  if (["recorded", "rec"].includes(s)) return "pending"; // legado vira pending
  return s;
}

/* =========================
 * Subschemas
 * ========================= */
const ServiceTypeSchema = new Schema<IServiceType>(
  {
    id:   { type: String, required: true, set: (s: string) => (s ?? "").trim() },
    name: { type: String, default: "",   set: (s: string) => properCase(s || "") },
  },
  { _id: false }
);

const PartnerRefSchema = new Schema<IPartnerRef>(
  {
    id:    { type: String, required: true, set: (s: string) => (s ?? "").trim() },
    name:  { type: String, set: (s: string) => properCase(s || "") },
    email: { type: String, set: (s: string) => (s ?? "").trim() },
  },
  { _id: false }
);

/* =========================
 * Schema principal
 * ========================= */
const ServiceSchema = new Schema<IService>(
  {
    serviceDate: { type: Date, required: true, index: true },

    firstName:  { type: String, default: "", set: (s: string) => properCase(s || "") },
    lastName:   { type: String, default: "", set: (s: string) => properCase(s || "") },
    clientName: { type: String, default: "" }, // calculado nos hooks

    park:     { type: String, default: "", set: (s: string) => properCase(s || "") },
    location: { type: String, default: "", set: (s: string) => properCase(s || "") },
    guests:   { type: Number, default: null, min: 0 },
    hopper:   { type: Boolean, default: false },

    team: { type: String, default: "", set: (s: string) => properCase(s || "") },

    finalValue: { type: Number, required: true, min: 0 },

    serviceType:   { type: ServiceTypeSchema, default: null },
    serviceTypeId: { type: String, default: "", set: (s: string) => (s ?? "").trim() },

    partnerId: { type: String, index: true, default: "", set: (s: string) => (s ?? "").trim() },
    partner:   { type: PartnerRefSchema, default: null },

    serviceTime:     { type: Number, default: null, min: 0 },
    observations:    { type: String, default: "", set: (s: string) => (s ?? "").trim() },
    overrideValue:   { type: Number, default: null },
    calculatedPrice: { type: Schema.Types.Mixed, default: null },
    status:          { type: String, default: "pending", set: (s: string) => normalizeStatus(s) },
  },
  {
    timestamps: true,
    collation: { locale: "en", strength: 2 },
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  }
);

/* =========================
 * Middlewares
 * ========================= */
function buildClientName(src: { firstName?: string; lastName?: string }) {
  const fn = (src.firstName || "").trim();
  const ln = (src.lastName || "").trim();
  return [fn, ln].filter(Boolean).join(" ");
}

ServiceSchema.pre("save", function (next) {
  if (!this.clientName || this.isModified("firstName") || this.isModified("lastName")) {
    this.clientName = buildClientName(this as any);
  }
  next();
});

ServiceSchema.pre("insertMany", function (next: (err?: any) => void, docs: any[]) {
  docs?.forEach((d) => {
    // normaliza nomes e clientName
    d.firstName = properCase(d.firstName || "");
    d.lastName  = properCase(d.lastName || "");
    if (!d.clientName) d.clientName = buildClientName(d);
    // status canônico
    if (d.status) d.status = normalizeStatus(d.status);
  });
  next();
});

ServiceSchema.pre("findOneAndUpdate", function (next) {
  const update: any = this.getUpdate() || {};
  const $set = update.$set || (update.$set = {});

  // padroniza campos de texto (Title Case)
  if (typeof $set.firstName === "string") $set.firstName = properCase($set.firstName);
  if (typeof $set.lastName  === "string") $set.lastName  = properCase($set.lastName);
  if (typeof $set.park      === "string") $set.park      = properCase($set.park);
  if (typeof $set.location  === "string") $set.location  = properCase($set.location);
  if (typeof $set.team      === "string") $set.team      = properCase($set.team);
  if ($set.partner?.name)   $set.partner.name = properCase($set.partner.name);
  if ($set.serviceType?.name) $set.serviceType.name = properCase($set.serviceType.name);

  // clientName só recalcula se vierem os 2 nomes
  const fn = ($set.firstName ?? update.firstName);
  const ln = ($set.lastName  ?? update.lastName);
  const hasFn = typeof fn === "string";
  const hasLn = typeof ln === "string";

  if (($set.clientName == null && update.clientName == null) && hasFn && hasLn) {
    $set.clientName = buildClientName({ firstName: fn, lastName: ln });
    this.setUpdate(update);
  }

  if (typeof $set.status === "string") $set.status = normalizeStatus($set.status);

  next();
});

/* =========================
 * Índices úteis
 * ========================= */
ServiceSchema.index({ partnerId: 1, serviceDate: -1 });
ServiceSchema.index({ "partner.id": 1, serviceDate: -1 });
ServiceSchema.index({ "partner.name": 1, serviceDate: -1 });
ServiceSchema.index({ serviceTypeId: 1, serviceDate: -1 });
ServiceSchema.index({ firstName: 1, serviceDate: -1 });
ServiceSchema.index({ clientName: 1, serviceDate: -1 });
ServiceSchema.index({ team: 1, serviceDate: -1 });
ServiceSchema.index({ status: 1, serviceDate: -1 });
ServiceSchema.index({ serviceDate: -1, _id: -1 });

export const Service = model<IService>("Service", ServiceSchema);
