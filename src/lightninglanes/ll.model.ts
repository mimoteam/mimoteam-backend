import mongoose, { Schema, Types } from "mongoose";

export type LaneStatus = "pending" | "approved" | "rejected" | "paid";

export interface LightningLane {
  _id: Types.ObjectId;
  partnerId: Types.ObjectId | string;
  partnerFullName?: string;            // ← NEW
  clientName: string;
  laneType: "single" | "multi" | "premier";
  amount: number;
  paymentMethod: "mimo_card" | "client";
  cardLast4?: string | null;
  visitDate?: Date | null;
  receipts: string[];
  status: LaneStatus;
  observation?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LightningLaneSchema = new Schema<LightningLane>(
  {
    partnerId: { type: Schema.Types.Mixed, required: true },
    partnerFullName: { type: String, default: "", trim: true }, // ← NEW
    clientName: { type: String, required: true, trim: true },
    laneType: { type: String, enum: ["single", "multi", "premier"], required: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: ["mimo_card", "client"], required: true },
    cardLast4: { type: String, default: null },
    visitDate: { type: Date, default: null },
    receipts: { type: [String], default: [] },
    status: { type: String, enum: ["pending", "approved", "rejected", "paid"], default: "pending" },
    observation: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

LightningLaneSchema.index({ createdAt: -1 });

export default mongoose.models.LightningLane ||
  mongoose.model<LightningLane>("LightningLane", LightningLaneSchema);
