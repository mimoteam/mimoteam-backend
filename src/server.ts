import app from "./app";
import { connectMongo } from "./config/db";
import { env } from "./config/env";

async function runSeedIfAny() {
  if (env.NODE_ENV === "production") return;
  try {
    // @ts-ignore - módulo opcional
    const mod = await import("./dev/seed");
    const fn = (mod as any).seedIfEmpty ?? (mod as any).default;
    if (typeof fn === "function") {
      await fn();
      console.log("[SEED] ok");
    }
  } catch {
    console.log("[SEED] arquivo ausente, ignorando");
  }
}

async function bootstrap() {
  console.log(`[INIT] NODE_ENV=${env.NODE_ENV}`);
  console.log(`[INIT] CORS_ORIGIN=${env.CORS_ORIGIN ?? "*"}`);

  try {
    await connectMongo();
  } catch (e) {
    console.error("[INIT] Abortando por falha no Mongo.", e);
    process.exit(1);
  }

  await runSeedIfAny();

  app.listen(env.PORT, () => {
    console.log(`[HTTP] Server running on http://localhost:${env.PORT}`);
  });
}

bootstrap();
