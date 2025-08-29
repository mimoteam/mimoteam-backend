import { z } from "zod";

export const RoleEnum = z.enum(["admin", "partner", "finance"]);

export const CreateUserSchema = z.object({
  fullName: z.string().min(1, "required"),
  email: z.string().email("invalid email"),
  login: z.string().min(3, "min 3"),
  password: z.string().min(6, "min 6"),
  role: RoleEnum,
  funcao: z.string().optional().default(""),
  team: z.string().optional().default(""),
});

export const UpdateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  login: z.string().min(3).optional(),
  password: z.string().min(6).optional(),
  role: RoleEnum.optional(),
  funcao: z.string().optional(),
  team: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const ListQuerySchema = z.object({
  q: z.string().optional(),
  role: RoleEnum.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
