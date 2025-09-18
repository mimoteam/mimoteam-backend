import { z } from "zod";

export const createBillingSchema = z.object({
  client: z.string().min(1, "client é obrigatório"),
  service: z.enum(["lightning_lane", "food", "concierge", "ticket", "other"]),
  observation: z.string().optional().default(""),
  amount: z.number().positive("amount deve ser > 0"),
  origin: z.enum(["admin", "lightning_lane", "other"]).optional().default("admin"),
  status: z.enum(["TO_BE_ADD", "PENDING", "PAID", "CANCELLED"]).optional().default("TO_BE_ADD"),
});

export const updateBillingSchema = z
  .object({
    client: z.string().min(1).optional(),
    service: z.enum(["lightning_lane", "food", "concierge", "ticket", "other"]).optional(),
    observation: z.string().optional(),
    amount: z.number().positive().optional(),
    origin: z.enum(["admin", "lightning_lane", "other"]).optional(),
    status: z.enum(["TO_BE_ADD", "PENDING", "PAID", "CANCELLED"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Envie ao menos um campo para atualizar",
  });
