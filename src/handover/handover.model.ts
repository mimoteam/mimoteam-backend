import mongoose, { Schema, Types } from "mongoose";

export interface HandoverComment {
  _id: Types.ObjectId;
  body: string;
  author?: string | null;
  authorName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HandoverNote {
  _id: Types.ObjectId;
  type: string;     // "To Know" | "To Do" | etc.
  tag: string;      // "urgent" | "pending" | "routine" | "info"
  body: string;
  author?: string | null;
  authorName?: string | null;
  comments: HandoverComment[];
  createdAt: Date;
  updatedAt: Date;
}

const CommentSchema = new Schema<HandoverComment>(
  {
    body: { type: String, required: true, trim: true },
    author: { type: String, default: null },
    authorName: { type: String, default: null },
  },
  { timestamps: true }
);

const HandoverSchema = new Schema<HandoverNote>(
  {
    type: { type: String, required: true, trim: true },
    tag: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    author: { type: String, default: null },
    authorName: { type: String, default: null },
    comments: { type: [CommentSchema], default: [] },
  },
  { timestamps: true }
);

export const Handover = mongoose.models.Handover || mongoose.model<HandoverNote>("Handover", HandoverSchema);
