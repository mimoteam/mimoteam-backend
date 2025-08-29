// backend/src/payments/payment.model.ts
import { Schema, model, Document } from 'mongoose';

interface INoteLog {
  id: string;
  text: string;
  at: Date;
}

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

const NoteLogSchema = new Schema<INoteLog>(
  {
    id:   { type: String, required: true },
    text: { type: String, required: true },
    at:   { type: Date,   required: true },
  },
  { _id: false }
);

const PaymentSchema = new Schema<IPayment>(
  {
    partnerId:   { type: String, required: true, index: true },
    partnerName: { type: String, default: "" },
    periodFrom:  { type: String, default: null },
    periodTo:    { type: String, default: null },
    weekKey:     { type: String, default: null, index: true },
    weekStart:   { type: String, default: null },
    weekEnd:     { type: String, default: null },
    serviceIds:  { type: [String], default: [] },
    extraIds:    { type: [String], default: [] },
    total:       { type: Number, default: 0 },
    status:      { type: String, enum: ['CREATING','SHARED','APPROVED','PENDING','DECLINED','ON_HOLD','PAID'], default: 'PENDING' },
    notes:       { type: String, default: '' },
    notesLog:    { type: [NoteLogSchema], default: [] },
  },
  { timestamps: true }
);

PaymentSchema.index({ partnerId: 1, weekKey: 1 });

export default model<IPayment>('Payment', PaymentSchema);
