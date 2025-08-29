import mongoose from 'mongoose';
import { env } from './env';

export async function connectMongo() {
  const t0 = Date.now();
  console.log('[DB] Conectando ao Mongo...');
  try {
    await mongoose.connect(env.MONGO_URI, {
      serverSelectionTimeoutMS: 12000, // 12s
      socketTimeoutMS: 20000,
      maxPoolSize: 5,
    } as any);

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] Desconectado');
    });
    mongoose.connection.on('reconnected', () => {
      console.log('[DB] Re-conectado');
    });

    console.log(`[DB] Conectado em ${Date.now() - t0}ms`);
  } catch (err: any) {
    console.error('[DB] Falha ao conectar:', err?.message || err);
    throw err;
  }
}
