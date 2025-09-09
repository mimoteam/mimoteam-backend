// src/config/db.ts
import mongoose from "mongoose";
import { env } from "./env";

mongoose.set("strictQuery", true);
mongoose.set("debug", !!env.ENABLE_MONGOOSE_DEBUG);

function hasDbInUri(u: string) {
  // mongodb://host/db?x=1  ou mongodb+srv://host/db
  return /^mongodb(\+srv)?:\/\/[^/]+\/[^?]+/i.test(u);
}

function buildUriAndDb() {
  const base = (env.MONGO_URI || "").replace(/\/$/, "");
  if (hasDbInUri(base)) return { uri: base, dbName: undefined as string | undefined };
  return { uri: `${base}/${env.DB_NAME}`, dbName: env.DB_NAME };
}

export async function connectMongo() {
  const { uri, dbName } = buildUriAndDb();

  await mongoose.connect(uri, {
    dbName, // undefined se já veio no URI
    autoIndex: !env.isProd,
  } as any);

  const c = mongoose.connection;
  c.on("connected", () => console.log("[mongo] connected:", uri));
  c.on("error", (e) => console.error("[mongo] error:", e));
  c.on("disconnected", () => console.warn("[mongo] disconnected"));
  return c;
}
