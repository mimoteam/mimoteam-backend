// src/handover/handover.schemas.ts
import { z } from "zod";

export const ListHandoverQuerySchema = z.object({
  q: z.string().trim().optional(),
  type: z.enum(["To Know", "To Do", "Question", "VIP Client", "Guideline", "Customer Service"]).optional(),
  tag:  z.enum(["urgent", "pending", "routine", "info"]).optional(),
  from: z.coerce.date().optional(),
  to:   z.coerce.date().optional(),
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

export const CreateHandoverSchema = z.object({
  type: z.enum(["To Know", "To Do", "Question", "VIP Client", "Guideline", "Customer Service"]),
  tag:  z.enum(["urgent", "pending", "routine", "info"]),
  body: z.string().trim().min(3),
});

export const AddCommentSchema = z.object({
  body: z.string().trim().min(2),
});
