import mongoose, { Schema, Types } from "mongoose";

export interface TaskDoc {
  _id: Types.ObjectId;
  text: string;
  status: "todo" | "in_progress" | "done";
  completed: boolean;
  priority?: "low" | "medium" | "high";
  dueDate?: Date | null;
  assignedToId?: string | null;
  assignedToName?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<TaskDoc>(
  {
    text: { type: String, required: true, trim: true },
    status: { type: String, enum: ["todo", "in_progress", "done"], default: "todo", index: true },
    completed: { type: Boolean, default: false, index: true },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    dueDate: { type: Date, default: null },
    assignedToId: { type: String, default: null, index: true },
    assignedToName: { type: String, default: null },
    createdBy: { type: String, default: null },
    createdByName: { type: String, default: null },
  },
  { timestamps: true }
);

export const Task = mongoose.models.Task || mongoose.model<TaskDoc>("Task", TaskSchema);
