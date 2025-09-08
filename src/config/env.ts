// src/config/env.ts
import dotenv from "dotenv";

// Carrega .env da raiz do projeto (onde está seu package.json)
dotenv.config();

function req(name: string, fallback = "") {
  const v = process.env[name];
  return (v && v.trim()) || fallback;
}

export const env = {
  NODE_ENV: req("NODE_ENV", "development"),
  PORT: req("PORT", "4000"),
  MONGODB_URI: req("MONGODB_URI", ""),
  JWT_SECRET: req("JWT_SECRET", ""),     // <- importante!
  CORS_ORIGIN: req("CORS_ORIGIN", ""),
};

// Pequeno log defensivo para confirmar em runtime
if (!env.JWT_SECRET) {
  console.warn("[env] ATENÇÃO: JWT_SECRET não definido!");
} else {
  console.log("[env] JWT_SECRET prefix:", env.JWT_SECRET.slice(0, 8));
}
