import { z } from "zod";

export const CreateTaskSchema = z.object({
  text: z.string().min(1),
  priority: z.enum(["low","medium","high"]).optional(),
  dueDate: z.string().datetime().optional().or(z.null()),
  assignedToId: z.string().optional().or(z.null()),
  assignedToName: z.string().optional().or(z.null()),
});

export const PatchTaskSchema = z.object({
  text: z.string().min(1).optional(),
  status: z.enum(["todo","in_progress","done"]).optional(),
  completed: z.boolean().optional(),
  priority: z.enum(["low","medium","high"]).optional(),
  dueDate: z.string().datetime().optional().or(z.null()),
  assignedToId: z.string().optional().or(z.null()),
  assignedToName: z.string().optional().or(z.null()),
});

export const ListTaskQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(500).default(200),
  q: z.string().optional(),
  completed: z.preprocess((v)=> (v===undefined? undefined : String(v)==="1"||String(v).toLowerCase()==="true"), z.boolean().optional()),
  status: z.enum(["todo","in_progress","done"]).optional(),
  assignedToId: z.string().optional(),
  includeTotal: z.coerce.number().min(0).max(1).default(1),
});
