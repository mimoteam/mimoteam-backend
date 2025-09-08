// src/config/db.ts
import mongoose from "mongoose";
import { env, isProd } from "./env";

// Ajustes globais do Mongoose (seguros)
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

if (env.ENABLE_MONGOOSE_DEBUG) {
  mongoose.set("debug", true);
}

export async function connectMongo() {
  const t0 = Date.now();
  console.log("[DB] Conectando ao Mongo...");

  try {
    const opts: mongoose.ConnectOptions = {
      serverSelectionTimeoutMS: 12_000,
      socketTimeoutMS: 20_000,
      maxPoolSize: 5,
      autoIndex: !isProd, // em produção, normalmente false
      // family: 4, // descomente se tiver issues com IPv6
    };

    // Se DB_NAME vier, força o db correto independente do que tiver na URI
    if (env.DB_NAME) {
      (opts as any).dbName = env.DB_NAME;
    }

    // ⬇️ guarda a conexão retornada (tipagem melhor) 
    const conn = await mongoose.connect(env.MONGODB_URI, opts);

    // Eventos úteis de conexão
    conn.connection.on("connected", () => {
      console.log("[DB] Conectado");
    });
    conn.connection.on("disconnected", () => {
      console.warn("[DB] Desconectado");
    });
    conn.connection.on("reconnected", () => {
      console.log("[DB] Re-conectado");
    });
    conn.connection.on("error", (err) => {
      console.error("[DB] Erro de conexão:", err);
    });

    // Ping simples para garantir que está OK (com guarda de undefined)
    try {
      const db = conn.connection.db;
      if (db) {
        await db.admin().command({ ping: 1 });
      } else {
        console.warn("[DB] Ping ignorado: connection.db ainda indefinido");
      }
    } catch (e) {
      console.warn("[DB] Ping falhou (continua rodando):", (e as any)?.message);
    }

    console.log(
      `[DB] Conectado em ${Date.now() - t0}ms — dbName=${
        conn.connection.name || env.DB_NAME || "(from URI)"
      }`
    );
  } catch (err: any) {
    console.error("[DB] Falha ao conectar:", err?.message || err);
    throw err;
  }
}

export async function disconnectMongo() {
  try {
    await mongoose.disconnect();
    console.log("[DB] Conexão encerrada");
  } catch (e: any) {
    console.error("[DB] Erro ao encerrar conexão:", e?.message || e);
  }
}
