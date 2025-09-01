// scripts/upsert-admin.ts
import 'dotenv/config';
import mongoose from 'mongoose';

// 👉 seu model fica em src/users/user.model.ts
// na maioria dos projetos Mongoose com TS, ele exporta "default"
import UserModel from '../src/users/user.model';
// Se der erro "does not have a default export", troque a linha acima por:
// import { default as UserModel } from '../src/users/user.model';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  await mongoose.connect(uri);

  const email = process.env.ADMIN_EMAIL ?? 'admin@mimo.local';
  const login = process.env.ADMIN_LOGIN ?? 'admin';
  const pass  = process.env.ADMIN_PASS  ?? 'Admin123456';
  const name  = process.env.ADMIN_NAME  ?? 'Admin Local';

  // Usa o hook pre('findOneAndUpdate') para hashear senha quando não começa com $2
  const user = await (UserModel as any).findOneAndUpdate(
    { login },
    {
      $set: {
        fullName: name,
        email,
        login,
        role: 'admin',
        status: 'active',
        password: pass, // será hasheada pelo hook
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  console.log('✅ Admin upserted:', { id: user?._id?.toString(), email: user?.email, login });
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('❌ Falhou:', e);
  process.exit(1);
});
