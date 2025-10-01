import { Schema, model, Document } from "mongoose";

interface INoteLog { id: string; text: string; at: Date; }

export interface IPayment extends Document {
  partnerId: string;
  partnerName?: string;

  // Agora como Date (antes eram string)
  periodFrom?: Date | null;
  periodTo?: Date | null;
  weekKey?: string | null;
  weekStart?: Date | null;
  weekEnd?: Date | null;

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

const PaymentSchema = new Schema<IPayment>({
  partnerId:   { type: String, required: true, index: true },
  partnerName: { type: String, default: "" },

  // ✅ Datas como Date
  periodFrom:  { type: Date, default: null, index: true },
  periodTo:    { type: Date, default: null },
  weekKey:     { type: String, default: null, index: true },
  weekStart:   { type: Date, default: null, index: true },
  weekEnd:     { type: Date, default: null },

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

/* ── Índices úteis p/ listagem ── */
PaymentSchema.index({ partnerId: 1, status: 1, weekStart: -1 });
PaymentSchema.index({ weekStart: -1 });
PaymentSchema.index({ createdAt: -1 });

/* ── Dedup dos arrays ── */
PaymentSchema.pre('save', function (next) {
  if (Array.isArray(this.serviceIds)) this.serviceIds = Array.from(new Set(this.serviceIds.map(String)));
  if (Array.isArray(this.extraIds))  this.extraIds  = Array.from(new Set(this.extraIds.map(String)));
  next();
});

export default model<IPayment>('Payment', PaymentSchema);
