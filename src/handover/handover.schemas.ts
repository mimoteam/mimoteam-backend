import { z } from "zod";

export const ListHNQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(500).default(200),
  q: z.string().optional(),
  type: z.string().optional(),
  tag: z.string().optional(),
  includeTotal: z.coerce.number().min(0).max(1).default(1),
});

export const CreateHNNoteSchema = z.object({
  type: z.string().min(1),
  tag: z.string().min(1),
  body: z.string().min(1),
});

export const AddCommentSchema = z.object({
  body: z.string().min(1),
});
