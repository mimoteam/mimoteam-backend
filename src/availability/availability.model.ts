// backend/src/availability/availability.model.ts
import { Schema, model, type Document } from "mongoose";

export type AvState = "busy" | "unavailable"; // 'available' é implícito (sem documento)
export type AvBy = "admin" | "partner";

export interface IAvailability extends Document {
  partnerId: string;
  date: string;             // YYYY-MM-DD
  state: AvState;           // busy | unavailable
  by: AvBy;                 // admin | partner
  createdAt: Date;
  updatedAt: Date;
}

const AvailabilitySchema = new Schema<IAvailability>(
  {
    partnerId: { type: String, required: true, index: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    state: { type: String, enum: ["busy", "unavailable"], required: true },
    by: { type: String, enum: ["admin", "partner"], required: true },
  },
  { timestamps: true }
);

// um registro por (partnerId, date)
AvailabilitySchema.index({ partnerId: 1, date: 1 }, { unique: true });

export const Availability = model<IAvailability>("Availability", AvailabilitySchema);
