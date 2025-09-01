// src/tasks/task.schemas.ts
import { z } from "zod";

export const ListTasksQuerySchema = z.object({
  q: z.string().trim().optional(),
  completed: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") {
        const s = v.toLowerCase();
        if (["1", "true", "yes", "y"].includes(s)) return true;
        if (["0", "false", "no", "n"].includes(s)) return false;
      }
      return undefined;
    }),
  assignedToId: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  includeTotal: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      const raw = String(v ?? "1").toLowerCase();
      return !(raw === "0" || raw === "false" || raw === "no");
    }),
});

export const CreateTaskSchema = z.object({
  text: z.string().trim().min(2),
  priority: z.enum(["low", "medium", "high"]).default("medium").optional(),
  dueDate: z.coerce.date().optional().nullable(),
  assignedToId: z.string().trim().optional(),
  assignedToName: z.string().trim().optional(),
});

export const UpdateTaskSchema = z.object({
  text: z.string().trim().min(2).optional(),
  completed: z.boolean().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  dueDate: z.coerce.date().optional().nullable(),
  assignedToId: z.string().trim().nullable().optional(),
  assignedToName: z.string().trim().nullable().optional(),
});
