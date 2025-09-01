// src/handover/handover.model.ts
import { Schema, model, models, type Document, type Model, Types } from "mongoose";

export type HandoverType = "To Know" | "To Do" | "Question" | "VIP Client" | "Guideline" | "Customer Service";
export type HandoverTag  = "urgent" | "pending" | "routine" | "info";

export interface IHandoverComment {
  _id: Types.ObjectId;
  body: string;
  authorId?: Types.ObjectId | null;
  authorName?: string | null;
  createdAt: Date;
}

export interface IHandover extends Document {
  _id: Types.ObjectId;
  type: HandoverType;
  tag: HandoverTag;
  body: string;

  authorId?: Types.ObjectId | null;
  authorName?: string | null;

  comments: IHandoverComment[];

  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IHandoverComment>(
  {
    body: { type: String, required: true, trim: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    authorName: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true, id: false }
);

const handoverSchema = new Schema<IHandover>(
  {
    type: { type: String, enum: ["To Know", "To Do", "Question", "VIP Client", "Guideline", "Customer Service"], required: true },
    tag:  { type: String, enum: ["urgent", "pending", "routine", "info"], required: true },
    body: { type: String, required: true, trim: true },

    authorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    authorName: { type: String, default: null },

    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

// índices
handoverSchema.index({ createdAt: -1 });
handoverSchema.index({ type: 1, createdAt: -1 });
handoverSchema.index({ tag: 1, createdAt: -1 });
handoverSchema.index(
  { body: "text", "comments.body": "text" },
  { name: "handover_text", weights: { body: 5, "comments.body": 2 } }
);

// limpeza
handoverSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret || {};
    return rest;
  },
});
handoverSchema.set("toObject", {
  virtuals: true,
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret || {};
    return rest;
  },
});

const HandoverModel: Model<IHandover> =
  (models.Handover as Model<IHandover>) || model<IHandover>("Handover", handoverSchema);

export default HandoverModel;
export { HandoverModel };
