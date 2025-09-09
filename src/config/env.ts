// src/config/env.ts
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Aceita MONGODB_URI, MONGO_URI ou MONGO_URL
const raw = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MONGODB_URI:
    process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  DB_NAME: process.env.DB_NAME,
  ENABLE_MONGOOSE_DEBUG: process.env.ENABLE_MONGOOSE_DEBUG, // "1" | "true" | etc.
};

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, "Defina MONGODB_URI (ou MONGO_URI/MONGO_URL) no .env"),
  JWT_SECRET: z.string().min(1, "Defina JWT_SECRET no .env"),
  CORS_ORIGIN: z.string().default("*"),
  DB_NAME: z.string().optional(),
  ENABLE_MONGOOSE_DEBUG: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string")
        return ["1", "true", "yes", "on"].includes(v.toLowerCase());
      return false;
    }),
});

const parsed = EnvSchema.parse(raw);

export const env = parsed;
export const isProd = parsed.NODE_ENV === "production";
export const corsOrigins = parsed.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

// Logs úteis (sem vazar segredo)
try {
  const masked = parsed.MONGODB_URI.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
  console.log("[env] NODE_ENV:", parsed.NODE_ENV);
  console.log("[env] MONGODB_URI:", masked);
  if (!parsed.JWT_SECRET) console.warn("[env] ATENÇÃO: JWT_SECRET vazio!");
} catch {}
