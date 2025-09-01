// scripts/upsert-admin.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import UserModel from '../src/users/user.model';

async function main() {
  const MONGO_URI = process.env.MONGO_URI!;
  if (!MONGO_URI) throw new Error('MONGO_URI não definido');

  const login  = process.env.ADMIN_LOGIN  || 'admin';
  const email  = process.env.ADMIN_EMAIL  || 'admin@mimo.local';
  const pwdRaw = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || 'changeme';
  const fullName = process.env.ADMIN_NAME || 'Admin User';

  await mongoose.connect(MONGO_URI);

  const hash = await bcrypt.hash(pwdRaw, 10);

  const existing = await UserModel.findOne({ $or: [{ login }, { email }] }).select('_id').lean();

  if (existing) {
    await UserModel.updateOne(
      { _id: existing._id },
      { $set: { fullName, login, email, password: hash, role: 'admin', status: 'active' } }
    );
  } else {
    await UserModel.create({
      fullName,
      login,
      email,
      password: hash,
      role: 'admin',
      status: 'active',
    });
  }

  // Busca id para log
  const saved = await UserModel.findOne({ login }).select('_id').lean();

  console.log('✅ Admin upserted:', {
    id: saved?._id?.toString(),
    login,
    email,
    password: pwdRaw, // mostrado só aqui no script para facilitar o teste
  });

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
