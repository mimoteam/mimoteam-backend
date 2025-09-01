// src/tasks/task.model.ts
import { Schema, model, models, type Document, type Model, Types } from "mongoose";

export type TaskPriority = "low" | "medium" | "high";

export interface ITask extends Document {
  _id: Types.ObjectId;
  text: string;
  completed: boolean;
  priority: TaskPriority;
  dueDate?: Date | null;

  createdById?: Types.ObjectId | null;
  createdByName?: string | null;

  assignedToId?: Types.ObjectId | null;
  assignedToName?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    text: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false, index: true },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    dueDate: { type: Date, default: null },

    createdById: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    createdByName: { type: String, default: null },

    assignedToId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedToName: { type: String, default: null },
  },
  { timestamps: true }
);

// índices
taskSchema.index({ createdAt: -1 });
taskSchema.index({ text: "text" }, { name: "task_text" });

// limpeza json
taskSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret || {};
    return rest;
  },
});
taskSchema.set("toObject", {
  virtuals: true,
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret || {};
    return rest;
  },
});

const TaskModel: Model<ITask> = (models.Task as Model<ITask>) || model<ITask>("Task", taskSchema);
export default TaskModel;
export { TaskModel };
