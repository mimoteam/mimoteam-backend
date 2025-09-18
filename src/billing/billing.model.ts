import mongoose, { Schema, type Document, type Model } from "mongoose";

export type BillingStatus = "TO_BE_ADD" | "PENDING" | "PAID" | "CANCELLED";
export type BillingService =
  | "lightning_lane"
  | "food"
  | "concierge"
  | "ticket"
  | "other";

export interface IBilling extends Document {
  client: string;
  service: BillingService;
  observation?: string;
  amount: number;
  origin?: "admin" | "lightning_lane" | "other";
  status: BillingStatus;
  createdAt: Date;
  updatedAt: Date;
}

const BillingSchema = new Schema<IBilling>(
  {
    client: { type: String, required: true, trim: true },
    service: {
      type: String,
      required: true,
      enum: ["lightning_lane", "food", "concierge", "ticket", "other"],
    },
    observation: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0 },
    origin: {
      type: String,
      default: "admin",
      enum: ["admin", "lightning_lane", "other"],
    },
    status: {
      type: String,
      default: "TO_BE_ADD",
      enum: ["TO_BE_ADD", "PENDING", "PAID", "CANCELLED"],
    },
  },
  { timestamps: true }
);

BillingSchema.index({ createdAt: -1 });

export const Billing: Model<IBilling> =
  mongoose.models.Billing || mongoose.model<IBilling>("Billing", BillingSchema);

export default Billing;
