// src/config/env.ts
import "dotenv/config";

function bool(v: any, def = false) {
  if (v === undefined || v === null || v === "") return def;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(s);
}
function num(v: any, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  get isProd() {
    return (process.env.NODE_ENV || "development") === "production";
  },

  PORT: num(process.env.PORT, 4000),

  // Mongo
  MONGO_URI:
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017",
  DB_NAME:
    process.env.DB_NAME ||
    process.env.MONGO_DB ||
    process.env.MONGODB_DB ||
    "mimoteam",

  ENABLE_MONGOOSE_DEBUG: bool(process.env.ENABLE_MONGOOSE_DEBUG, false),

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || "dev-only-secret",

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
} as const;

// compat para imports antigos: import { isProd } from './env'
export const isProd = env.isProd;
