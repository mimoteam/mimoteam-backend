import { z } from 'zod';

export const LoginSchema = z.object({
  user: z.string().min(1),       // login OU email
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof LoginSchema>;
