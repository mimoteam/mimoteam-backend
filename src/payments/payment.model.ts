// backend/src/payments/payment.model.ts
import { Schema, model, Document } from "mongoose";

interface INoteLog { id: string; text: string; at: Date; }

export interface IPayment extends Document {
  partnerId: string;
  partnerName?: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  weekKey?: string | null;
  weekStart?: string | null;
  weekEnd?: string | null;
  serviceIds: string[];
  extraIds: string[];
  total: number;
  status: 'CREATING' | 'SHARED' | 'APPROVED' | 'PENDING' | 'DECLINED' | 'ON_HOLD' | 'PAID';
  notes?: string;
  notesLog?: INoteLog[];
  createdAt: Date;
  updatedAt: Date;
}

const NoteLogSchema = new Schema<INoteLog>({
  id:   { type: String, required: true },
  text: { type: String, required: true },
  at:   { type: Date,   required: true },
}, { _id: false });

// converte valor em Date ISO string ou null
const toIsoOrNull = (v: any) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const PaymentSchema = new Schema<IPayment>({
  partnerId:   { type: String, required: true, index: true },
  partnerName: { type: String, default: "" },

  periodFrom:  { type: String, default: null, set: toIsoOrNull },
  periodTo:    { type: String, default: null, set: toIsoOrNull },
  weekKey:     { type: String, default: null, index: true },
  weekStart:   { type: String, default: null, set: toIsoOrNull, index: true },
  weekEnd:     { type: String, default: null, set: toIsoOrNull },

  serviceIds:  { type: [String], default: [] },
  extraIds:    { type: [String], default: [] },

  total:       { type: Number,  default: 0 },
  status:      { type: String,  enum: ['CREATING','SHARED','APPROVED','PENDING','DECLINED','ON_HOLD','PAID'], default: 'PENDING', index: true },

  notes:       { type: String,  default: '' },
  notesLog:    { type: [NoteLogSchema], default: [] },
}, {
  timestamps: true,
  minimize: false,
  versionKey: false,
});

// índices úteis p/ listagem
PaymentSchema.index({ partnerId: 1, status: 1, weekStart: -1 });
PaymentSchema.index({ weekStart: -1 });
PaymentSchema.index({ createdAt: -1 });

// dedup dos arrays
PaymentSchema.pre('save', function (next) {
  if (Array.isArray(this.serviceIds)) this.serviceIds = Array.from(new Set(this.serviceIds.map(String)));
  if (Array.isArray(this.extraIds)) this.extraIds = Array.from(new Set(this.extraIds.map(String)));
  next();
});

export default model<IPayment>('Payment', PaymentSchema);
